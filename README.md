# OFF — Open Freedom Forum

Private conversations. Open communities.

A responsive single-page community platform: pseudonymous discussion rooms, password authentication, and realtime messaging backed by Supabase (database, Auth, Postgres RLS, and Realtime).

## What it is

- **Landing + auth**: Sign in or create an account with a pseudonym and a password only. A username is chosen and checked for availability against the database before it is claimed.
- **Rooms**: A seeded public **World** room plus interest rooms. Users can join public rooms, create custom private rooms, and open a DM thread.
- **Chat**: Optimistic message sending with a client event id, realtime delivery, per-sender grouping, and an honest connection (`○ Connecting…`) indicator — no fabricated `LIVE` state.
- **Onboarding**: A four-step flow — recovery notice, profile, country, interests — with progress tracked in auth metadata and, once trusted, reflected in the profiles table.

## Architecture and security model

- The client uses only `VITE_SUPABASE_URL` and a publishable/anon key. There is **no service-role credential path** in the client.
- RLS is **authoritative and never disabled or broadened**: private rooms/messages are restricted to members, message writes verify ownership, and roles are constrained by database triggers (`owner_invariant`, `member_can_join`, role guards).
- Writes that must be safe (room creation with advisory-locked slug serialization, username status, ownership) are exposed as `security definer` RPCs with `search_path = public` that reject unauthenticated callers.
- No analytics, tracking pixels, IP reads, session replay, fingerprinting, or external scripts.
- **Recovery is intentionally a documented placeholder** (`recoveryNotice`), not a cryptographic key backup. It is versioned as an honest ceremony rather than a fake mechanism.

## Product decisions / current limitations (V1)

- **Country detection is a documented stub**: the user picks from pre-populated interest slugs; there is no IP-based geo lookup and no tracking.
- **Google OAuth was removed in the privacy-first pivot**: no Google/`signInWithOAuth` surface remains in code, tests, or config. Generic OAuth infrastructure in `supabase/config.toml` comments is left untouched but unused.
- **Media uploads are intentionally off** until a server-side re-encode / metadata-cleaning endpoint exists and is tested.
- **Rate limits, blocks/reports, moderation, DMs-to-anyone broadening, invitations, and receipts** remain future work.
- **Recovery phrase ceremony is a placeholder**, not a real key backup.

## Run locally

```bash
cp .env.example .env.local   # fill in your Supabase URL + publishable key
npm install
npm run dev
```

Env vars (`.env.local`):

| Variable | Meaning |
| --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The anon / publishable key (never a service-role key) |

## Apply migrations

Create a Supabase project, then apply the migration files **in order** (they reset relevant policies and build top of each other):

```
supabase/migrations/202609060001_off_mvp.sql
… (every 20260906000N_*.sql in order)
supabase/migrations/202609070001_username_status.sql
```

The full set (16 files) is required; later migrations enforce message-target integrity, ownership invariants, onboarding state transitions, username/identity integrity, and the `username_status` RPC used by the signup checker.

### Email confirmation (V1)

V1 ships with hosted email confirmation **OFF**. The auth transport is a
derived pseudo-email (`<username>@off.app`), which is not deliverable. With
confirmation off, anonymous self-signup returns an immediate session and the
`handle_new_user` trigger auto-creates the profile. The UI reports Supabase
errors without enumerating an account during registration.

Set email confirmation per your deployment policy; if turned ON, anonymous
self-signup with the pseudo-email transport will no longer return a session.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server (Vite) |
| `npm run typecheck` | TypeScript typecheck (`tsc -b`) |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite (static + behavior tests, no browser) |
| `npm run smoke` | Boots the production build (`vite preview`) and runs a headless-Chrome render + asset smoke against it (skips if no Chrome present) |
| `npm run build` | Typecheck + production build to `dist/` |

## Testing, honestly labeled

All tests run in Node/Vitest. They are **static and behavior tests, not browser/E2E tests** — there is no browser in CI. Coverage is grouped as:

- **UNIT/STATIC** — pure logic: password strength, username canonicalization/validation, sender-name precedence, message grouping/reconcile, onboarding progress, permissions matrix, layout helpers.
- **STATIC (config/source)** — architecture invariants: no service-role keys, RLS policies present, CSP/security headers, `index.html` metadata, no external scripts, no tracking.
- **INTEGRATION (RPC failure paths)** — availability lookup degrading to `idle` on failure, message reconcile idempotency.
- **MANUAL/UNVERIFIED** — anything that requires a running browser, the real Supabase network, or the external Dashboard.

The following are **not** represented as passing automated tests; they are manual QA procedures to run against a live deployment:

1. **Two-account RLS check**: with users A and B, verify B cannot read/post A's private custom room, and that role/ownership guards hold (owner cannot be demoted; member cannot become owner).
2. **Mobile widths**: verify the responsive shell, sheets, bottom nav, and 44px touch targets across a phone width.
3. **Realtime**: send from a second tab/window and confirm delivery + connection indicator transitions.
4. **Visual/pixel**: OG image and apple-touch-icon appearance on real social/CDN surfaces.

## Deploy

`npm run build` produces static assets in `dist/`. `wrangler.jsonc` mounts `./dist` as Workers Static Assets with a SPA single-page fallback, which honors `public/_headers` (copied into `dist`). Headers shipped include a strict CSP (`connect-src` limited to self + `https://*.supabase.co` and `wss://*.supabase.co` for realtime), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS, and a `Permissions-Policy` that denies unused browser APIs.

Canonical production URL: `https://off.testingver.workers.dev/`

## Manual database integration checklist (pre-release)

After applying all migrations to a fresh Supabase project with two authenticated users, run the role-based checks:

- A non-member cannot select or insert private-room messages.
- An interest/custom-room visitor can discover but cannot post until joining.
- A member insert cannot set `role` to moderator/owner.
- A member cannot update membership roles.
- A sender cannot update/delete another sender's message.
- A DM participant cannot access a thread they do not participate in.
- Owners cannot be demoted or deleted (`owner_invariant` trigger).

These are database integration checks and are **not** part of the automated test suite.
