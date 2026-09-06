-- Phase 1.5: make the DM target model valid and narrow membership capabilities.
create table if not exists public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  participant_low uuid not null references public.profiles(id) on delete cascade,
  participant_high uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (participant_low < participant_high), unique (participant_low, participant_high)
);
alter table public.dm_threads enable row level security;
create policy "participants read dm threads" on public.dm_threads for select to authenticated using (auth.uid() in (participant_low, participant_high));
alter table public.messages alter column room_id drop not null;
alter table public.messages add constraint messages_thread_id_fkey foreign key (thread_id) references public.dm_threads(id) on delete cascade;
create index if not exists messages_thread_created_idx on public.messages(thread_id, created_at) where thread_id is not null;
create or replace function public.can_access_thread(target_thread uuid, target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.dm_threads where id=target_thread and target_user in (participant_low, participant_high)) $$;
revoke all on function public.can_access_thread(uuid,uuid) from public; grant execute on function public.can_access_thread(uuid,uuid) to authenticated;
drop policy if exists "join public custom rooms" on public.room_members;
drop policy if exists "owners moderate membership" on public.room_members;
create policy "join eligible public room as member" on public.room_members for insert to authenticated with check (user_id=auth.uid() and role='member' and exists(select 1 from public.rooms where id=room_id and not is_private and kind in ('interest','custom')));
create policy "moderators add members" on public.room_members for insert to authenticated with check (public.is_room_moderator(room_id) and role in ('member','moderator'));
create policy "moderators change member roles" on public.room_members for update to authenticated using (public.is_room_moderator(room_id)) with check (public.is_room_moderator(room_id) and role in ('member','moderator'));
create policy "members leave or moderators remove" on public.room_members for delete to authenticated using (user_id=auth.uid() or public.is_room_moderator(room_id));
drop policy if exists "read authorized room messages" on public.messages;
drop policy if exists "send to authorized room" on public.messages;
create policy "read authorized messages" on public.messages for select to authenticated using ((room_id is not null and exists(select 1 from public.rooms where id=room_id and (kind='world' or public.is_room_member(id)))) or (thread_id is not null and public.can_access_thread(thread_id)));
create policy "send authorized messages" on public.messages for insert to authenticated with check (sender_id=auth.uid() and ((room_id is not null and exists(select 1 from public.rooms where id=room_id and (kind='world' or public.is_room_member(id)))) or (thread_id is not null and public.can_access_thread(thread_id))));
