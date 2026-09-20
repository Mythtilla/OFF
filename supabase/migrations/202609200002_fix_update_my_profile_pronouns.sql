-- HOTFIX: re-create update_my_profile with the pronouns variable renamed.
--
-- The 202609170004 version declares a plpgsql local named `pronouns` while the
-- migration also adds a `pronouns` column to profiles; inside
-- `set pronouns = ...` the reference became ambiguous
-- (`column reference "pronouns" is ambiguous`) once both existed. The local
-- variable is renamed to `new_pronouns` so the UPDATE target column resolves.
-- Only this one function is re-created; nothing else in 170004 changes.

create or replace function public.update_my_profile(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_username text;
  canonical text;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  private_payload jsonb;
  link jsonb;
  link_visibility text;
  mentions uuid[] := '{}'::uuid[];
  new_pronouns text[] := '{}'::text[];
  featured jsonb;
  result jsonb;
begin
  perform require_authenticated();
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'Payload must be a JSON object';
  end if;

  new_username := payload->>'username';
  if new_username is not null and new_username <> '' then
    canonical := lower(btrim(new_username));
    if canonical !~ '^[a-z0-9_]{3,32}$' then
      raise exception 'Username must be 3-32 lowercase letters, numbers or underscores';
    end if;
    if canonical <> (select username from public.profiles where id = uid) then
      if exists (select 1 from public.profiles where username = canonical and id <> uid) then
        raise exception 'That username is taken';
      end if;
      update auth.users
         set email = canonical || '@off.app',
             raw_user_meta_data = raw_user_meta_data || jsonb_build_object('username', canonical)
       where id = uid;
      update auth.identities
         set email = canonical || '@off.app',
             provider_id = canonical || '@off.app'
       where user_id = uid and provider = 'email';
    end if;
    new_username := canonical;
  end if;

  mentions := (select coalesce(p.bio_mentions, '{}'::uuid[]) from public.profiles p where p.id = uid);
  if payload ? 'bio_mentions' and jsonb_typeof(payload->'bio_mentions') = 'array' then
    mentions := coalesce((
      select array_agg(x::uuid)
      from jsonb_array_elements_text(payload->'bio_mentions') e(x)
      where x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ), '{}'::uuid[]);
  end if;
  mentions := coalesce((
    array(
      select m.id
      from unnest(mentions) as m(id)
      where m.id <> uid
        and exists (select 1 from public.profiles q where q.id = m.id)
        and not public.is_blocked(uid, m.id)
        and not public.is_blocked(m.id, uid)
    )
  )[1:32], '{}'::uuid[]);

  if payload ? 'pronouns' and jsonb_typeof(payload->'pronouns') = 'array' then
    new_pronouns := coalesce((
      select array_agg(x)
      from jsonb_array_elements_text(payload->'pronouns') e(x)
    ), '{}'::text[]);
  end if;

  featured := payload->'featured_song';
  if featured = 'null'::jsonb then featured := null; end if;

  update public.profiles
     set display_name = case when payload ? 'display_name'
            then nullif(btrim(payload->>'display_name'), '') else display_name end,
         username = coalesce(new_username, username),
         bio = case when payload ? 'bio'
            then nullif(btrim(payload->>'bio'), '') else bio end,
         bio_mentions = mentions,
         pronouns = new_pronouns,
         profile_status = case when payload ? 'profile_status'
            then nullif(btrim(payload->>'profile_status'), '') else profile_status end,
         featured_song = case when payload ? 'featured_song' then featured else featured_song end,
         discoverable = coalesce((payload->>'discoverable')::boolean, discoverable),
         contactable = coalesce((payload->>'contactable')::boolean, contactable),
         mention_visibility = case when payload ? 'mention_visibility'
            then coalesce(nullif(payload->>'mention_visibility', ''), mention_visibility)
            else mention_visibility end,
         avatar_url = case
           when payload ? 'avatar_url' then nullif(payload->>'avatar_url', '')
           else avatar_url
         end
   where id = uid;

  delete from public.profile_links where profile_id = uid;
  if jsonb_typeof(coalesce(payload->'links', '[]'::jsonb)) = 'array' then
    for link in select * from jsonb_array_elements(coalesce(payload->'links', '[]'::jsonb)) loop
      if (select count(*) from public.profile_links where profile_id = uid) >= 8 then
        exit;
      end if;
      link_visibility := coalesce(link->>'visibility', 'everyone');
      if link_visibility not in ('only_me', 'connections', 'everyone') then
        continue;
      end if;
      if btrim(coalesce(link->>'label', '')) = '' or char_length(link->>'label') > 40 then
        raise exception 'Link labels must be 1-40 characters';
      end if;
      if coalesce(link->>'url', '') !~* '^https?://' or char_length(link->>'url') > 2048 then
        raise exception 'Links must be full http(s) URLs of at most 2048 characters';
      end if;
      insert into public.profile_links (profile_id, label, url, visibility)
      values (uid, btrim(link->>'label'), link->>'url', link_visibility);
    end loop;
  end if;

  private_payload := coalesce(payload->'private', '{}'::jsonb);
  if jsonb_typeof(private_payload) <> 'object' then
    raise exception 'private must be an object';
  end if;
  insert into public.profile_private (
    profile_id, real_name, date_of_birth, location_text,
    personal_visibility, location_visibility
  ) values (
    uid,
    nullif(btrim(coalesce(private_payload->>'real_name', '')), ''),
    case when coalesce(private_payload->>'date_of_birth', '') = '' then null
         else (private_payload->>'date_of_birth')::date end,
    nullif(btrim(coalesce(private_payload->>'location_text', '')), ''),
    coalesce(nullif(private_payload->>'personal_visibility', ''), 'only_me'),
    coalesce(nullif(private_payload->>'location_visibility', ''), 'only_me')
  )
  on conflict (profile_id) do update set
    real_name = excluded.real_name,
    date_of_birth = excluded.date_of_birth,
    location_text = excluded.location_text,
    personal_visibility = excluded.personal_visibility,
    location_visibility = excluded.location_visibility;

  result := public.public_profile((select username from public.profiles where id = uid));
  return result;
end;
$$;

revoke all on function public.update_my_profile(jsonb) from public;
grant execute on function public.update_my_profile(jsonb) to authenticated;