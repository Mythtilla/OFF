# OFF — ENVIRONMENTS.md

Status: 2026-09-13 — V1 environment separation complete.

## Environments

| Environment | Purpose | Supabase project | Where configured | Status |
|---|---|---|---|---|
| LOCAL | local dev/test; runs against the local Docker stack when `supabase start` is up | `config.toml` project `OFF`, port 54321 | `supabase/config.toml`, env unset/placeholder | available; not required for the deployed app |
| **V1 (production)** | the live site + Worker + database | `afkxawjhaoobdnegaekp` (eu-central-1) | `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`); CLI linked; migrations 001→016 applied; World-only seed | **active** — verified live at `https://off.testingver.workers.dev` (Cloudflare account `9adb20cd…`, worker `off`, subdomain `testingver`; Version `ff31e71c…`) |
| OLD (archive) | original single hosted project — retired, must not be modified | `yiwygvsqrcouqsjjtgiq` (eu-central-1) | only historical references in `docs/`; CLI no longer linked to it | **archived** |

## Verified V1 state (2026-09-14)

- Migrations 001→016 applied via `supabase db push` to `afkxawjhaoobdnegaekp`.
- Seed applied: **1 World room, 0 other rooms** (re-verified after two-user testing, which was cleaned up).
- Auth transport: deterministic pseudo-email is `<username>@off.app` (`AUTH_EMAIL_DOMAIN` in `src/services/auth/username.ts`); hosted **email confirmation is OFF**, so anonymous self-signup returns an immediate session (verified live 2026-09-14: signup → session → profile auto-created via `handle_new_user` → `username_status` reflects the claim → admin-delete cascades → username freed).
- Owner login provisioned (V1): auth user `mythtilla@off.app`, username **`mythtilla`** (immutable — set via `user_metadata.username`), email-confirmed, password chosen by owner, `onboarding_completed = false` (owner completes onboarding in the app). Usernames cannot be changed (guard RPC).
- Gate green: typecheck, lint, 198/198 tests, build, smoke.
- Deployed bundle `/assets/index-uMVUTzio.js` embeds the V1 URL; zero references to the old project.
- Legacy copy: the earlier deployment `https://open-freedom-forum.photo-studio.workers.dev` (Cloudflare account `ea63398d…`, subdomain `photo-studio`) still exists on the old account and serves the same V1 bundle/Supabase project; it can only be deleted from that account. New home is account `9adb20cd…`.
- The old project was not touched during any step.

## Secrets & safety

- No service-role/secret key is stored in the repo, in `.env.local`, or in any build artifact.
- The V1 project's secret key was used transiently (admin provisioning of the two synthetic test users) and was not persisted, printed, or committed; both test users were deleted afterwards.
- Never edit or run anything against `yiwygvsqrcouqsjjtgiq`. Reset tooling targets V1 only and still requires explicit owner confirmation.

## Known decisions (V1)

- **Anonymous self-signup is enabled.** Hosted "Confirm email" is OFF and the
  pseudo-email transport is `@off.app` (a valid TLD, so GoTrue accepts it).
  Verified live 2026-09-14: `signup` returns an immediate session, the
  `handle_new_user` trigger auto-creates the profile, and `username_status`
  gates claims. Keep `AUTH_EMAIL_DOMAIN` stable — changing it breaks all
  existing logins (auth emails are derived deterministically from usernames).
- See `docs/DATABASE-RESET.md` and `docs/V1-MASTER-IMPLEMENTATION-PLAN.md` for
  the reset + build contract.