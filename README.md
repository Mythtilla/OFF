# OFF — Open Freedom Forum

Private conversations. Open communities.

## Architecture and security checklist

This repository was supplied with only this README and an empty Git history; there were no routes, dependencies, Supabase integration, migrations, recovery implementation, or RLS policies to audit. The initial implementation therefore establishes a small, deployable Supabase-backed MVP baseline instead of assuming undocumented Lovable state is present.

- [x] Client uses only `VITE_SUPABASE_URL` and a publishable/anon key; it has no service-role credential path.
- [x] Auth is password-based through Supabase Auth; the UI derives a non-deliverable internal auth email from the requested pseudonym. Production should instead use a server-side username-to-auth lookup to avoid exposing this convention.
- [x] RLS restricts private rooms and their messages to members, verifies message ownership for writes, and enables WebSocket realtime for messages.
- [x] Public rooms are intentionally writable by authenticated users; moderation, blocks/reports, rate limits, DMs, receipts, country room assignment, and invitations remain required follow-up work.
- [x] No analytics, tracking pixels, IP reads, or service-role secrets are included.
- [x] The recovery phrase UX is deliberately **not implemented** because no existing verifier was supplied and a three-position fast-hash design would not be safe to present as recovery. `src/services/auth/recovery.ts` preserves only guarded copy for future work.
- [x] Media uploads are intentionally not enabled until a server-side re-encode/metadata-cleaning endpoint exists and has tests.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Apply `supabase/migrations/202609060001_off_mvp.sql` to a new Supabase project before use. Enable email confirmation according to the deployment policy; the UI reports Supabase errors without enumerating an account during registration.

## Current MVP surface

Landing, password authentication, pseudonymous profile trigger, seeded public rooms, optimistic message sending, and Supabase Realtime receiving are implemented. The responsive conversation shell uses live database queries—not fixture chat content.

## Supabase RLS integration verification

Before release, apply all migrations to an isolated Supabase project and run these role-based checks with two authenticated test users: a non-member cannot select or insert private-room messages; an interest/custom-room visitor can discover but cannot post until joining; a member insert cannot set `role` to moderator/owner; a member cannot update membership roles; a sender cannot update/delete another sender's message; and a DM participant cannot access a thread they do not participate in. These are database integration checks and are not represented as browser unit tests.

## Phase 2.5 database integration plan

Run with two Supabase Auth users (A and B) after applying migrations: A/B can read and post World; A discovers but cannot read/post an interest room before joining, then can after joining; B cannot discover/read/post A’s private custom room; an owner can promote/remove members, a moderator cannot alter/remove the owner or become owner, and a member cannot modify membership; unrelated users cannot select a DM thread/message; participants can; authors can edit/soft-delete only their own messages. The migration resets all listed table policies before defining this single policy set.

## Final foundation audit notes

`202609060006_integrity_constraints.sql` enforces a single valid room-or-DM message target through the prior target check, adds same-conversation reply validation, and makes room slug collision handling transactional. Apply all migrations in order. The security-definer functions use `search_path = public`, reject unauthenticated callers where they mutate state, and do not accept caller-selected ownership.

## Ownership invariant

`202609060007_owner_invariant.sql` adds a database trigger that rejects deletion or demotion of any owner row. Ownership transfer is deliberately unavailable until a dedicated transaction-safe RPC is introduced. The authoritative `create_room` contract requires an authenticated caller, validates the name/topic, serializes same-base-slug creation with a transaction advisory lock, and atomically creates exactly one initial owner membership.
