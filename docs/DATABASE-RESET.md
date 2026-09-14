# OFF — DATABASE-RESET.md

Status: **V1 environment separation completed 2026-09-13.** The V1 project is the only Supabase project the app and the CLI touch. The original single hosted project is archived and must not be modified.

## Current environment state (verified 2026-09-14)

| Source | Value | Verdict |
|---|---|---|
| `wrangler.jsonc` / deploy URL | `https://off.testingver.workers.dev/` (worker `off`, account `9adb20cd…`) | public site served by V1 |
| `.env.local` (`VITE_SUPABASE_URL`) | `https://afkxawjhaoobdnegaekp.supabase.co` | **V1 project (active)** |
| `.env.local` (key) | publishable/anon key only; **no service-role key anywhere in repo**; the project's secret key was used transiently for admin test-user provisioning and was never persisted, printed, or committed |
| Deployed Worker bundle (`/assets/index-uMVUTzio.js`, fetched live) | embeds `https://afkxawjhaoobdnegaekp.supabase.co`; zero references to the old ref | deployed site uses ONLY the V1 project |
| `supabase/.temp/project-ref` + `linked-project.json` | ref `afkxawjhaoobdnegaekp`, org `kmdkpwviohwixylvgwvk` | Supabase CLI is LINKED to V1 |
| Old hosted project | ref `yiwygvsqrcouqsjjtgiq`, org `mcuzxgotwnlmcarwsqgt` | **ARCHIVED — do not link, push, or reset** |
| `supabase/config.toml` | `project_id = "OFF"`, local port 54321 | local Docker stack only |
| Repo-wide search | no other `supabase.co` project ref outside `docs/` historical notes | separate dev/staging/production project only for V1 and the archive |

**Conclusion: resets against the V1 project are safe for V1 data but destructive to live V1 infrastructure — they still require explicit human owner confirmation when run directly against the hosted V1 project.** The old project must never be touched.

**Recommended path: reset in place on V1 (Path C) or recreate fresh (see "New project path (executed)" below).** Do NOT touch `yiwygvsqrcouqsjjtgiq`.

## What the reset does and does not do

Done by the scripts:
- Deletes all messages, DM threads, interest mappings, room memberships.
- Deletes every room except World.
- Deletes all profiles AND auth accounts (`auth.users`, cascades identity rows).
- Guarantees exactly one World room and verifies counts; failure rolls back the whole transaction.
- An upfront schema guard aborts (and rolls back) if the OFF core tables or the `room_kind` enum are absent, so a wrong database fails loudly instead of silently succeeding.

NOT done by the scripts (by design):
- No `DROP TABLE` / `DROP POLICY` / `DROP FUNCTION` / schema changes.
- No disabling of RLS, no weakening of policies, no service-role exposure.
- No mutation of `auth.account_deletion` / password hashes beyond deleting accounts.
- Nothing touchable by the anon key.

## Execution paths

### A. Local CLI (`supabase db reset`)
1. `supabase start` (docker-based local stack).
2. `supabase db reset` — re-runs all migrations, then loads `supabase/seed.sql`, producing a fresh **World-only** local database. This is the supported workflow for local development.

### B. New project path (EXECUTED 2026-09-13 — create a fresh V1 project)
1. Create a new empty project in the Supabase Dashboard (same region eu-central-1). **DONE — `afkxawjhaoobdnegaekp`.**
2. Link the CLI to it: `supabase link --project-ref afkxawjhaoobdnegaekp` (overwrites `.temp` state). **DONE.**
3. Apply all 16 migrations: `supabase db push`. **DONE — 001→016 applied cleanly.**
4. Apply `supabase/seed.sql` (World-only, idempotent) via `supabase db query --linked --file supabase/seed.sql`. **DONE — verified 1 World room, 0 others.**
5. Put the new project's URL + **new** anon/publishable key in `.env.local` (never a service-role key). **DONE.**
6. `npm run build` then `wrangler deploy` so the live Worker serves the new project. **DONE — live bundle verified to embed the new URL with zero old-ref hits.**
7. Old project `yiwygvsqrcouqsjjtgiq` left untouched as an archive; delete only later with explicit confirmation.

### C. In-place reset of the V1 project (destructive, requires owner confirmation)
```bash
supabase link --project-ref afkxawjhaoobdnegaekp   # already linked to V1
supabase db query --linked -f scripts/reset-to-world.sql  # requires admin (postgres/supabase_admin); schema-guarded + transactional
# then verify:
#   select slug, kind from rooms;        -- 1 row: world
#   select count(*) from messages;       -- 0
#   select count(*) from profiles;       -- 0
#   select count(*) from auth.users;     -- 0
```
The old project `yiwygvsqrcouqsjjtgiq` must NEVER be the target of this script.

Caveat for hosted: `auth.users` deletion is irreversible and point-in-time recovery is not guaranteed across all plans — confirm retention before running. This path destroys the live backend's data and is only justified if the owner decides the deployed app's data is fully disposable.

## Migration discipline

- All schema evolution goes through `supabase/migrations/` (16 files so far). Never hand-alter the remote schema out-of-band; a local edit without an identical timestamped migration file makes `db reset` diverge from production.
- Test every new migration locally with `supabase db reset` + `supabase db diff`.

## Post-reset expectations

After the operator confirms + runs the reset:
- Existing accounts, custom rooms, messages, memberships: gone.
- The single World room remains, empty.
- Next signup auto-creates a profile via `handle_new_user`.
- Realtime/RLS behavior identical to before reset (schema untouched).

## Outstanding (not executed, must not be executed by an automated agent)

- [x] Create the new `off-v1` Supabase project and migrate/seed it (Path B) — **DONE 2026-09-13** (`afkxawjhaoobdnegaekp`).
- [x] Re-link the CLI to the new project (`.temp` now targets `afkxawjhaoobdnegaekp`).
- [x] Auth transport and self-signup **RESOLVED 2026-09-14**: pseudo-email is `@off.app` (`AUTH_EMAIL_DOMAIN` in `src/services/auth/username.ts`); hosted email confirmation is OFF; anonymous self-signup verified live (immediate session, profile auto-created via trigger, `username_status` gates claims). Keep `AUTH_EMAIL_DOMAIN` stable.
- [ ] If the owner ever chooses an in-place reset on V1: explicit owner confirmation, retention check, then Path C.
- [ ] Old project `yiwygvsqrcouqsjjtgiq`: retained as archive; delete only with explicit confirmation.