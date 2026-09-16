-- Message requests for private DMs (V1).
-- RLS-authoritative: read is scoped to the two parties; every mutation flows
-- through SECURITY DEFINER RPCs (see send_dm_request / accept_dm_request /
-- reject_dm_request / block_user / unblock_user), never direct table writes.
create table public.dm_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  constraint dm_requests_sender_not_self check (sender_id <> recipient_id),
  unique (sender_id, recipient_id)
);
alter table public.dm_requests enable row level security;
-- The recipient reads their inbound requests; the sender reads their own
-- outbound status. No insert/update/delete policies: state changes are RPC-only.
create policy dm_requests_select on dm_requests for select to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());
-- Defense in depth: drop the classic broad table grants for anon/public.
revoke all on table public.dm_requests from anon;
revoke all on table public.dm_requests from public;
grant select on table public.dm_requests to authenticated;
-- Requests arrive live (recipient-scoped via the SELECT policy above); payload
-- carries sender/status only, never message bodies.
alter publication supabase_realtime add table public.dm_requests;