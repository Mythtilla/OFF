# OFF — ENVIRONMENTS.md

Status: 2026-09-13 — V1 environment separation complete.

## Environments

| Environment | Purpose | Supabase project | Where configured | Status |
|---|---|---|---|---|
| LOCAL | local dev/test; runs against the local Docker stack when `supabase start` is up | `config.toml` project `OFF`, port 54321 | `supabase/config.toml`, env unset/placeholder | available; not required for the deployed app |
| **V1 (production)** | the live site + Worker + database | `afkxawjhaoobdnegaekp` (eu-central-1) | `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`); CLI linked; migrations 001→016 applied; World-only seed | **active** — verified live on `https://open-freedom-forum.photo-studio.workers.dev` |
| OLD (archive) | original single hosted project — retired, must not be modified | `yiwygvsqrcouqsjjtgiq` (eu-central-1) | only historical references in `docs/`; CLI no longer linked to it | **archived** |

## Verified V1 state (2026-09-13)

- Migrations 001→016 applied via `supabase db push` to `afkxawjhaoobdnegaekp`.
- Seed applied: **1 World room, 0 other rooms, 0 users, 0 messages, 0 memberships** (re-verified after two-user testing, which was cleaned up).
- Gate green: typecheck, lint, 198/198 tests, build, smoke.
- Two-user verification: 27/27 checks passed using the app's real client surface (login, profile autocreation, username availability, full onboarding chain, World read, message insert, sender-identity resolution through the `profiles` join, Realtime delivery, RLS rejection of anon/cross-user/forged accesses, logout, session restore).
- Deployed bundle `/assets/index-DveO6dhR.js` embeds the V1 URL; zero references to the old project.
- The old project was not touched during any step.

## Secrets & safety

- No service-role/secret key is stored in the repo, in `.env.local`, or in any build artifact.
- The V1 project's secret key was used transiently (admin provisioning of the two synthetic test users) and was not persisted, printed, or committed; both test users were deleted afterwards.
- Never edit or run anything against `yiwygvsqrcouqsjjtgiq`. Reset tooling targets V1 only and still requires explicit owner confirmation.

## Known limitation (V1)

- Hosted Supabase Auth rejects anonymous self-signup for the app's deterministic `username@off.invalid` transport (GoTrue email validation + required email confirmation). Sign-in works for provisioned (admin-created, email-confirmed) users. Decide the V1 auth transport before opening the site to anonymous registration. See `docs/DATABASE-RESET.md` — Outstanding.