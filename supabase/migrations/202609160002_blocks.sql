-- Server-enforced blocks for private conversations (V1).
-- RLS-authoritative: the block list is private to its owner; no other client
-- may enumerate or mutate it. Mutations flow through SECURITY DEFINER RPCs
-- (block_user / unblock_user) so the block predicate is evaluated server-side.
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self_block check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
-- A blocker may only read their own block rows. Blocked users never learn they
-- are blocked via the API; the effect is enforced inside the RPC boundaries.
create policy blocks_select_own on blocks for select to authenticated
  using (blocker_id = auth.uid());
-- Defense in depth: drop the classic broad table grants for anon/public.
revoke all on table public.blocks from anon;
revoke all on table public.blocks from public;
grant select on table public.blocks to authenticated;