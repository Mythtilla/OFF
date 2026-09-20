-- ============================================================================
-- HOSTING GAP-FILL: private DM requests + blocks + privacy RLS (idempotent)
-- Brings the hosted project in line with migrations 202609160001-160005.
-- Safe to run repeatedly (IF NOT EXISTS / DROP policy IF EXISTS / OR REPLACE).
-- ============================================================================

-- 1. dm_requests table (202609160001) --------------------------------------
create table if not exists public.dm_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  constraint dm_requests_sender_not_self check (sender_id <> recipient_id),
  unique (sender_id, recipient_id)
);
alter table public.dm_requests enable row level security;
drop policy if exists dm_requests_select on public.dm_requests;
create policy dm_requests_select on dm_requests for select to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());
revoke all on table public.dm_requests from anon;
revoke all on table public.dm_requests from public;
grant select on table public.dm_requests to authenticated;
do $$
begin
  begin
    alter publication supabase_realtime add table public.dm_requests;
  exception when duplicate_object then
    null;
  end;
end $$;

-- 2. blocks table (202609160002) -------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self_block check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
drop policy if exists blocks_select_own on public.blocks;
create policy blocks_select_own on blocks for select to authenticated
  using (blocker_id = auth.uid());
revoke all on table public.blocks from anon;
revoke all on table public.blocks from public;
grant select on table public.blocks to authenticated;

-- 3. privacy flag columns (202609160003, idempotent) ------------------------
alter table profiles add column if not exists discoverable boolean not null default false;
alter table profiles add column if not exists contactable boolean not null default false;

-- 4. narrow profile read policy + sender labels (202609160004) --------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or discoverable);

create or replace function public.resolve_sender_names(p_ids uuid[])
returns table (id uuid, username text, display_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where p.id = any(p_ids)
    and (p.id = auth.uid()
         or p.discoverable
         or exists (select 1 from public.messages m
                    where m.sender_id = p.id and (
                      (m.room_id is not null and exists(select 1 from public.rooms r where r.id = m.room_id and (r.kind = 'world' or public.is_room_member(r.id))))
                      or (m.thread_id is not null and public.can_access_thread(m.thread_id)))));
$$;
revoke all on function public.resolve_sender_names(uuid[]) from public;
grant execute on function public.resolve_sender_names(uuid[]) to authenticated;

-- 5. request/block lifecycle RPCs (202609160005) ----------------------------
create or replace function public.is_blocked(by_user uuid, target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where blocker_id = by_user and blocked_id = target)
$$;

create or replace function public.can_access_thread(target_thread uuid, target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dm_threads t
    where t.id = target_thread
      and target_user in (t.participant_low, t.participant_high)
      and not exists (
        select 1 from public.blocks b
        where b.blocked_id = target_user
          and b.blocker_id = case when target_user = t.participant_low then t.participant_high else t.participant_low end
      )
  )
$$;

create or replace function public.send_dm_request(target_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  result uuid;
  connected boolean;
begin
  perform require_authenticated();
  if target_user is null or target_user = auth.uid() then
    raise exception 'Cannot send a message request to yourself';
  end if;
  if not exists (select 1 from public.profiles where id = target_user) then
    raise exception 'User not found';
  end if;
  if public.is_blocked(auth.uid(), target_user) or public.is_blocked(target_user, auth.uid()) then
    raise exception 'Cannot send a message request to this user';
  end if;
  select exists (
    select 1 from public.dm_requests r
    where r.status = 'accepted'
      and (r.sender_id = auth.uid() and r.recipient_id = target_user or
            r.sender_id = target_user and r.recipient_id = auth.uid())
    union all
    select 1 from public.dm_threads t
    where auth.uid() in (t.participant_low, t.participant_high)
      and target_user in (t.participant_low, t.participant_high)
  ) into connected;
  if not connected and not (select contactable from public.profiles where id = target_user) then
    raise exception 'User is not accepting new conversations right now';
  end if;
  insert into public.dm_requests (sender_id, recipient_id)
  values (auth.uid(), target_user)
  on conflict (sender_id, recipient_id)
  do update set status = 'pending',
                created_at = now()
  where dm_requests.status <> 'accepted'
  returning id into result;
  return result;
end $$;

create or replace function public.accept_dm_request(request uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  req public.dm_requests%rowtype;
  low_id uuid; high_id uuid; thread_id uuid;
begin
  perform require_authenticated();
  select * into req from public.dm_requests where id = request;
  if req.id is null then raise exception 'Message request not found'; end if;
  if req.recipient_id <> auth.uid() then
    raise exception 'You are not the recipient of this request';
  end if;
  if req.status <> 'pending' then raise exception 'Message request is not pending'; end if;
  if public.is_blocked(auth.uid(), req.sender_id) or public.is_blocked(req.sender_id, auth.uid()) then
    raise exception 'Cannot accept this request';
  end if;
  update public.dm_requests set status = 'accepted' where id = request;
  low_id := least(auth.uid(), req.sender_id);
  high_id := greatest(auth.uid(), req.sender_id);
  insert into public.dm_threads (participant_low, participant_high)
  values (low_id, high_id)
  on conflict (participant_low, participant_high) do nothing
  returning id into thread_id;
  if thread_id is null then
    select id into thread_id from public.dm_threads
    where participant_low = low_id and participant_high = high_id;
  end if;
  return thread_id;
end $$;

create or replace function public.reject_dm_request(request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  req public.dm_requests%rowtype;
begin
  perform require_authenticated();
  select * into req from public.dm_requests where id = request;
  if req.id is null then raise exception 'Message request not found'; end if;
  if req.recipient_id <> auth.uid() then
    raise exception 'You are not the recipient of this request';
  end if;
  if req.status <> 'pending' then raise exception 'Message request is not pending'; end if;
  update public.dm_requests set status = 'rejected' where id = request;
end $$;

create or replace function public.block_user(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_authenticated();
  if target_user is null or target_user = auth.uid() then
    raise exception 'Cannot block yourself';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), target_user)
  on conflict (blocker_id, blocked_id) do nothing;
  update public.dm_requests set status = 'rejected'
  where status = 'pending'
    and ((sender_id = auth.uid() and recipient_id = target_user)
      or (sender_id = target_user and recipient_id = auth.uid()));
end $$;

create or replace function public.unblock_user(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_authenticated();
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = target_user;
end $$;

create or replace function public.get_or_create_dm_thread(target_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  low_id uuid; high_id uuid; result uuid;
  request_ok boolean;
begin
  perform require_authenticated();
  if target_user = auth.uid() then raise exception 'Cannot message yourself'; end if;
  if public.is_blocked(auth.uid(), target_user) or public.is_blocked(target_user, auth.uid()) then
    raise exception 'Cannot message this user';
  end if;
  low_id := least(auth.uid(), target_user);
  high_id := greatest(auth.uid(), target_user);
  select exists (
    select 1 from public.dm_requests r
    where r.status = 'accepted'
      and ((r.sender_id = low_id and r.recipient_id = high_id)
        or (r.sender_id = high_id and r.recipient_id = low_id))
  ) into request_ok;
  if not request_ok and not exists (
    select 1 from public.dm_threads t
    where t.participant_low = low_id and t.participant_high = high_id
  ) then
    raise exception 'A mutual message request is required before you can start a conversation';
  end if;
  insert into public.dm_threads (participant_low, participant_high)
  values (low_id, high_id)
  on conflict (participant_low, participant_high) do nothing
  returning id into result;
  if result is null then
    select id into result from public.dm_threads
    where participant_low = low_id and participant_high = high_id;
  end if;
  return result;
end $$;

-- 6. search_users: force-recreate the modern read-only variant ---------------
-- NOTE: must be VOLATILE, not stable — it calls volatile rate_limited() which
-- does SELECT ... FOR UPDATE/INSERT; PostgREST runs stable functions in a
-- read-only transaction, which would raise 25006 on every call.
create or replace function public.search_users(p_query text, p_limit integer default 12)
returns table (id uuid, username text, display_name text, avatar_url text)
language plpgsql volatile security definer set search_path = public
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

-- grants -------------------------------------------------------------
revoke all on function public.search_users(text, integer) from public;
grant execute on function public.search_users(text, integer) to authenticated;
revoke all on function public.is_blocked(uuid,uuid) from public;
revoke all on function public.can_access_thread(uuid,uuid) from public;
revoke all on function public.send_dm_request(uuid) from public;
revoke all on function public.accept_dm_request(uuid) from public;
revoke all on function public.reject_dm_request(uuid) from public;
revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.get_or_create_dm_thread(uuid) from public;
grant execute on function public.is_blocked(uuid,uuid) to authenticated;
grant execute on function public.can_access_thread(uuid,uuid) to authenticated;
grant execute on function public.send_dm_request(uuid) to authenticated;
grant execute on function public.accept_dm_request(uuid) to authenticated;
grant execute on function public.reject_dm_request(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.get_or_create_dm_thread(uuid) to authenticated;