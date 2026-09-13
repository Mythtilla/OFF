-- OFF — Reset (development/testing only) → World-only clean state
--
-- GOAL: remove accounts, chats, memberships, custom/interest/country rooms
--       and every message, leaving ONLY the seeded World room.
--
-- SAFETY RULES
--   1. NEVER run this against a hosted/ambiguous project without an explicit
--      human confirmation that the project is a disposable development DB.
--   2. Requires elevated privileges (Supabase CLI / postgres, service_role or
--      superuser) — it deletes rows in auth.users, which the anon/publishable
--      key can never do. That is intentional.
--   3. Idempotent: deleting an already-empty table is a no-op; the final
--      verification raises and rolls back the whole transaction on failure.
--   4. Preserves schema, policies, functions, triggers and indexes. Data only.
--
-- Usage (after confirming the environment):
--   supabase link --project-ref <ref>   # or your psql DSN
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reset-to-world.sql
--
begin;

-- 0. Schema guard: fail loudly (and roll back) rather than silently succeed
--    against a database that is not the OFF schema. All of these objects must
--    exist exactly as OFF defines them before any row is touched.
do $$
begin
  if coalesce(to_regclass('auth.users'), 0) = 0
     or coalesce(to_regclass('public.rooms'), 0) = 0
     or coalesce(to_regclass('public.messages'), 0) = 0
     or coalesce(to_regclass('public.profiles'), 0) = 0
     or coalesce(to_regclass('public.user_interests'), 0) = 0
     or coalesce(to_regclass('public.dm_threads'), 0) = 0
  then
    raise exception 'Reset aborted: this database is missing OFF core objects (wrong schema).';
  end if;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'room_kind'
  ) then
    raise exception 'Reset aborted: public.room_kind enum is missing (wrong schema).';
  end if;
end $$;

-- 1. Content first: all messages (room + DM), all threads, all interests.
delete from public.messages;
delete from public.dm_threads;
delete from public.user_interests;

-- 2. Rooms except World. Deleting a room cascades its memberships and
--    messages. This must happen BEFORE profile deletion because rooms.created_by
--    has no ON DELETE CASCADE (a user-created room would block the account wipe).
delete from public.rooms where slug <> 'world';

-- 3. Accounts. auth.users deletion cascades profiles -> memberships -> messages
--    -> interests -> thread participants via the schema's ON DELETE CASCADE.
delete from auth.users;

-- 4. Ensure World exists and is the exactly-correct public seed (idempotent).
insert into public.rooms (slug, name, topic, kind, is_private)
values ('world', 'World', 'The global public room.', 'world', false)
on conflict (slug) do nothing;

-- 5. Verify the clean state; any mismatch aborts and rolls back everything.
do $$
declare
  world_rooms int;
  other_rooms int;
  remaining_profiles int;
  remaining_messages int;
begin
  select count(*) into world_rooms from public.rooms where slug = 'world';
  select count(*) into other_rooms from public.rooms where slug <> 'world';
  select count(*) into remaining_profiles from public.profiles;
  select count(*) into remaining_messages from public.messages;
  if world_rooms <> 1 then
    raise exception 'Reset failed: expected exactly 1 World room, found %', world_rooms;
  end if;
  if other_rooms <> 0 then
    raise exception 'Reset failed: expected 0 non-World rooms, found %', other_rooms;
  end if;
  if remaining_profiles <> 0 then
    raise exception 'Reset failed: expected 0 profiles, found %', remaining_profiles;
  end if;
  if remaining_messages <> 0 then
    raise exception 'Reset failed: expected 0 messages, found %', remaining_messages;
  end if;
end $$;

commit;

-- Post-conditions (assert in the Supabase Dashboard / psql afterwards):
--   SELECT slug, kind FROM rooms;                    -- 1 row: world
--   SELECT count(*) FROM messages;                   -- 0
--   SELECT count(*) FROM profiles;                   -- 0
--   SELECT count(*) FROM auth.users;                 -- 0