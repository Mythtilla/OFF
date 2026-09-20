-- Profile extras: richer profile system with privacy-first defaults.
--
-- Adds optional public extras (pronouns, profile status, featured song, links,
-- structured bio mentions) and a separate private section (real name, date of
-- birth, location) whose rows stay invisible to every non-owner because the
-- profiles_read policy is whole-row and private data must never live there.
--
-- Read paths: public_profile (renders a profile page under /u/:username) and
-- search_users (mention/name autocomplete). Write path: update_my_profile,
-- the single atomic RPC the profile editor calls. Mentions rewrite across bios
-- when a username changes, so @tokens never go stale.
--
-- UNREVIEWED-DEPLOYMENT: this migration is additive and is applied to any
-- Supabase instance before this build is hot-swapped (the frontend degrades
-- gracefully when the RPCs are absent).

-- 1. Public profile columns ---------------------------------------------------

alter table public.profiles
  add column pronouns text[] not null default '{}'::text[],
  add column profile_status text,
  add column featured_song jsonb,
  add column bio_mentions uuid[] not null default '{}'::uuid[],
  add column mention_visibility text not null default 'everyone';

alter table public.profiles
  add constraint profiles_pronouns_check check (
    cardinality(pronouns) <= 12
    and not exists (
      select 1 from unnest(pronouns) p
      where char_length(p) > 32 or p !~ '^[a-z][a-z /]*$'
    )
  ),
  add constraint profiles_profile_status_len check (profile_status is null or char_length(profile_status) <= 80),
  add constraint profiles_featured_song_check check (
    featured_song is null
    or (
      jsonb_typeof(featured_song) = 'object'
      and featured_song ? 'title'
      and featured_song ? 'artist'
      and char_length(coalesce(featured_song->>'title', '')) <= 80
      and char_length(coalesce(featured_song->>'artist', '')) <= 120
    )
  ),
  add constraint profiles_bio_mentions_check check (cardinality(bio_mentions) <= 32),
  add constraint profiles_mention_visibility_check
    check (mention_visibility in ('nobody', 'connections', 'everyone'));

-- mention_visibility default 'everyone': usernames are already visible to the
-- whole world through messages; a mention only adds a clickable link, and the
-- per-user control lets people tighten this.
comment on column public.profiles.mention_visibility is
  'Who may @mention this account: everybody, connections only, or nobody.';

-- 2. Private details (owner-only) --------------------------------------------

create table public.profile_private (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  real_name text check (real_name is null or char_length(real_name) <= 80),
  date_of_birth date,
  location_text text check (location_text is null or char_length(location_text) <= 80),
  personal_visibility text not null default 'only_me'
    check (personal_visibility in ('only_me', 'connections', 'everyone')),
  location_visibility text not null default 'only_me'
    check (location_visibility in ('only_me', 'connections', 'everyone')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_private enable row level security;

create policy "profile private owner select" on public.profile_private
  for select to authenticated using (profile_id = auth.uid());
create policy "profile private owner insert" on public.profile_private
  for insert to authenticated with check (profile_id = auth.uid());
create policy "profile private owner update" on public.profile_private
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- 3. Links -------------------------------------------------------------------

create table public.profile_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  url text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  visibility text not null default 'everyone'
    check (visibility in ('only_me', 'connections', 'everyone')),
  created_at timestamptz not null default now()
);

alter table public.profile_links enable row level security;

create policy "profile links owner select all" on public.profile_links
  for select to authenticated using (profile_id = auth.uid());
create policy "profile links public when everyone + discoverable" on public.profile_links
  for select to authenticated
  using (
    visibility = 'everyone'
    and exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.discoverable
    )
  );
-- Inserts/updates/deletes are write-only through update_my_profile (SECURITY
-- DEFINER); no client-level mutation policy exists on profile_links.

-- 4. Connection helper --------------------------------------------------------

-- "Connected" = shared DM thread or shared room membership; used to decide
-- who a non-discoverable profile is allowed to surface to.
create or replace function public.is_connected(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select a is not null
     and b is not null
     and a <> b
     and (
       exists (
         select 1 from public.dm_threads t
         where t.participant_low = least(a, b)
           and t.participant_high = greatest(a, b)
       )
       or exists (
         select 1 from public.room_members x
         join public.room_members y on y.room_id = x.room_id
         where x.user_id = a and y.user_id = b
       )
     )
$$;

-- 5. Search users for mentions/name lookup ------------------------------------

-- Returns users whose profile is reachable (discoverable, or already
-- connected) and whose mention_visibility allows the caller. Blocked parties
-- are never listed. Rate-limited per identity to prevent enumeration.
create or replace function public.search_users(p_query text, p_limit integer default 12)
returns table (id uuid, username text, display_name text, avatar_url text)
language plpgsql stable security definer set search_path = public
as $$
declare
  q text;
begin
  perform require_authenticated();
  q := lower(btrim(p_query));
  if q = '' or char_length(q) > 32 or q !~ '^[a-z0-9_ @-]+$' then
    return;
  end if;
  if not public.rate_limited('search_users:' || auth.uid()::text, 20, interval '1 minute') then
    return;
  end if;
  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.profiles p
    where p.id <> auth.uid()
      and (p.username ilike '%' || q || '%' or p.display_name ilike '%' || q || '%')
      and not public.is_blocked(auth.uid(), p.id)
      and not public.is_blocked(p.id, auth.uid())
      and (
        p.mention_visibility = 'everyone'
        or (p.mention_visibility = 'connections' and public.is_connected(auth.uid(), p.id))
      )
      and (p.discoverable or public.is_connected(auth.uid(), p.id))
    order by
      case
        when p.username = q then 0
        when p.username like q || '%' then 1
        else 2
      end,
      p.username
    limit least(greatest(coalesce(p_limit, 12), 1), 20);
end;
$$;

-- 6. Public profile page -------------------------------------------------------

-- Age helper: birthday -> whole years, never the raw date (the review forbids
-- ever auto-publishing a full birth date publicly).
create or replace function public.age_from_dob(dob date)
returns integer language sql immutable as $$
  select extract(year from age(now(), dob))::integer
$$;

-- Renders exactly what a profile page may show a given viewer: null when the
-- profile is unreachable (not discoverable, not connected, or blocked either
-- direction — deliberately indistinguishable from "not found").
create or replace function public.public_profile(p_username text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  viewing uuid := auth.uid();
  target uuid;
  self_view boolean;
  is_connected boolean;
  p public.profiles%rowtype;
  private_row public.profile_private%rowtype;
  result jsonb;
begin
  -- Require a valid, canonical username look-up (prevents probing garbage).
  if p_username is null or p_username !~ '^[a-z0-9_]{3,32}$' then
    return null;
  end if;
  select * into p from public.profiles where username = lower(p_username) limit 1;
  if p.id is null then
    return null;
  end if;
  target := p.id;
  if (viewing is not null and
      (public.is_blocked(viewing, target) or public.is_blocked(target, viewing))) then
    return null;
  end if;
  self_view := viewing is not null and viewing = target;
  is_connected := viewing is not null and public.is_connected(viewing, target);
  if not self_view and not is_connected and not p.discoverable then
    return null;
  end if;

  result := jsonb_build_object(
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'bio_mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'username', m.username, 'display_name', m.display_name)
        order by m.username)
      from public.profiles m
      where m.id = any(p.bio_mentions)
    ), '[]'::jsonb),
    'pronouns', p.pronouns,
    'profile_status', p.profile_status,
    'featured_song', p.featured_song,
    'interests', coalesce((
      select jsonb_agg(r.name order by r.name)
      from public.user_interests u
      join public.rooms r on r.id = u.interest_room_id
      where u.user_id = target and r.kind = 'interest'
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('label', l.label, 'url', l.url) order by lower(l.label))
      from public.profile_links l
      where l.profile_id = target
        and (
          self_view
          or (l.visibility = 'everyone')
          or (l.visibility = 'connections' and is_connected)
        )
    ), '[]'::jsonb),
    'discoverable', p.discoverable,
    'contactable', p.contactable,
    'mention_visibility', p.mention_visibility,
    'viewer_is_owner', self_view,
    'viewer_connected', is_connected,
    'can_message',
      viewing is not null
      and not self_view
      and not is_connected
      and p.contactable
  );

  -- Optional private section: visibility is per-field, and anonymous viewers
  -- never see it (viewing is null => personal_visibility 'everyone' is gated
  -- on a signed-in viewer).
  select * into private_row from public.profile_private where profile_id = target;
  if private_row.profile_id is not null then
    if viewing is not null
       and private_row.personal_visibility in ('everyone', 'connections')
       and (self_view or private_row.personal_visibility = 'everyone' or is_connected)
       and private_row.date_of_birth is not null then
      result := result || jsonb_build_object('age', public.age_from_dob(private_row.date_of_birth));
    end if;
    if viewing is not null
       and private_row.location_visibility in ('everyone', 'connections')
       and (self_view or private_row.location_visibility = 'everyone' or is_connected)
       and private_row.location_text is not null then
      result := result || jsonb_build_object('location', private_row.location_text);
    end if;
  end if;

  return result;
end;
$$;

-- 7. Update my profile (single atomic write path) -----------------------------

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
  pronouns text[] := '{}'::text[];
  featured jsonb;
  result jsonb;
begin
  perform require_authenticated();
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'Payload must be a JSON object';
  end if;

  -- Username change: identity + profile must move together, in one transaction.
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

  -- bio_mentions: parsed defensively, keep only references that still exist
  -- and are not blocked (either direction).
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

  -- Pronouns: only override when the payload actually supplies an array.
  if payload ? 'pronouns' and jsonb_typeof(payload->'pronouns') = 'array' then
    pronouns := coalesce((
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
         pronouns = pronouns,
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

  -- Links: replace the whole set (owner-owned, idempotent, bounded at 8).
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

  -- Private section: upsert, never touches the public row.
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

-- 8. Keep mention text in sync when a username changes ------------------------

create or replace function public.rewrite_mentions_on_rename()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.username is distinct from old.username and new.bio is not null
     and old.username is not null and new.username is not null then
    update public.profiles
       set bio = regexp_replace(bio, '@' || old.username || '(?![a-z0-9_])', '@' || new.username, 'ig')
     where bio is not null
       and bio ~* ('@' || old.username || '(?![a-z0-9_])')
       and id <> new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_rename_mention_rewrite
after update of username on public.profiles
for each row execute function public.rewrite_mentions_on_rename();

-- 9. Grants -------------------------------------------------------------------

revoke all on function public.is_connected(uuid, uuid) from public;
revoke all on function public.search_users(text, integer) from public;
revoke all on function public.public_profile(text) from public;
revoke all on function public.update_my_profile(jsonb) from public;
revoke all on function public.age_from_dob(date) from public;
grant execute on function public.is_connected(uuid, uuid) to authenticated;
grant execute on function public.search_users(text, integer) to authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
grant execute on function public.update_my_profile(jsonb) to authenticated;
grant execute on function public.age_from_dob(date) to authenticated;