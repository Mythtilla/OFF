-- Make privacy flags effectful (P0-C) and correct the profile read model (P0-A).
--
-- Prior draft referenced a non-existent user_id column and, more importantly,
-- the authoritative 005 policy `profiles_read ... using (true)` was left in
-- force, so an OR'd discoverable policy could never restrict anything. This
-- migration replaces the broad profile read with a narrow one and provides a
-- minimal sender-label RPC so World/room/thread rendering still resolves names
-- for non-discoverable users without exposing their full profile.

-- 1. Narrow profile visibility: owner always; others only when discoverable.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or discoverable);

-- 2. Minimal sender-label carve-out. Returns only id/username/display_name/avatar_url
--    (never bio, country, or other profile fields) for a user who posted in a
--    room the caller can read, a thread the caller can access, or is the
--    caller themselves. This keeps public conversation renderable while a
--    non-discoverable profile remains otherwise invisible.
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

-- 3. contactable is a reachability gate enforced inside send_dm_request (it
--    governs who may request a conversation), not a read-visibility switch, so
--    no contactable read policy is created here.
--    discoverable/contactable updates flow through the existing
--    profiles_update_self policy (id = auth.uid()); the trusted-field trigger
--    (015) only guards country_code/country_source and does not strip them.