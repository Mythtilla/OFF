-- Request/block lifecycle RPCs (V1). Makes dm_requests/blocks usable and
-- enforces the privacy boundary server-side.
--
-- Every RPC: SECURITY DEFINER, search_path=public, require_authenticated().
-- Table mutation paths are RPC-only (the tables themselves expose only a
-- scoped SELECT policy). Errors are deliberately non-enumerating where block
-- state must stay private to the blocker.

-- helper: has a blocked the other in the given direction?
create or replace function public.is_blocked(by_user uuid, target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where blocker_id = by_user and blocked_id = target)
$$;

-- The thread-access check now ALSO denies the blocked party: if one
-- participant blocked the other, the blocked side loses read+insert via every
-- messages policy that calls can_access_thread (005/003 messages_read,
-- messages_insert). The blocker keeps access.
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

-- Send a message request. One pending request per pair (unique constraint).
-- Refuses: self-messaging, blocked either direction, non-contactable stranger.
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
  do update set sender_id = excluded.sender_id
  returning id into result;
  return result;
end $$;

-- Recipient accepts a pending request -> creates the canonical thread.
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

-- Recipient rejects a pending request (no thread is created).
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

-- Block: creates the block, cancels any in-flight pending requests in either
-- direction, and (via the can_access_thread override above) immediately denies
-- the blocked party read/insert on existing threads. Idempotent.
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

-- Unblock: removes the block row (blocker-scoped only).
create or replace function public.unblock_user(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_authenticated();
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = target_user;
end $$;

-- Thread creation is now permissioned: an existing accepted request (either
-- direction) or an already-existing thread is required; blocks deny.
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

-- Grant model matches the existing helper RPCs.
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