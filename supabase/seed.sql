-- OFF — local development seed (Supabase CLI)
-- Loaded automatically after migrations during `supabase db reset`
-- (see `supabase/config.toml` → `[db.seed]`).
--
-- Reproduces the V1 clean state: ONLY the World room exists.
-- Migration 001 seeds interest rooms; the V1 reset removes them here so a
-- local reset matches production intent. Idempotent and transactional.
--
-- Running `supabase db reset` also drops/recreates all tables, so this file
-- is safe against any existing data in the same call. For an EXISTING
-- database, use scripts/reset-to-world.sql instead (it also clears accounts).

begin;

-- Content first, in dependency order.
delete from public.messages;
delete from public.dm_threads;
delete from public.user_interests;

-- Mappings, then rooms (cascades members and remaining messages).
delete from public.room_members
where room_id in (select id from public.rooms where slug <> 'world');

delete from public.rooms where slug <> 'world';

-- Guarantee exactly one World room.
insert into public.rooms (slug, name, topic, kind, is_private)
select 'world', 'World', 'The global public room.', 'world'::public.room_kind, false
where not exists (select 1 from public.rooms where slug = 'world');

-- Verify.
do $$
declare
  world_rooms int;
  other_rooms int;
begin
  select count(*) into world_rooms from public.rooms where slug = 'world';
  select count(*) into other_rooms from public.rooms where slug <> 'world';
  if world_rooms <> 1 then
    raise exception 'Seed failed: expected exactly 1 World room, found %', world_rooms;
  end if;
  if other_rooms <> 0 then
    raise exception 'Seed failed: expected 0 non-World rooms, found %', other_rooms;
  end if;
end $$;

commit;