create table public.user_interests (user_id uuid not null references public.profiles(id) on delete cascade, interest_room_id uuid not null references public.rooms(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id,interest_room_id));
alter table public.user_interests enable row level security;
create policy "users manage own interests" on public.user_interests for select to authenticated using(user_id=auth.uid());
create policy "users add own valid interests" on public.user_interests for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.rooms where id=interest_room_id and kind='interest'));
create policy "users remove own interests" on public.user_interests for delete to authenticated using(user_id=auth.uid());
