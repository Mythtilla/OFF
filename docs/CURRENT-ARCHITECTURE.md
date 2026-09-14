# OFF — CURRENT-ARCHITECTURE.md

Status: verified against source on 2026-09-12. This map supersedes prior informal descriptions.

## Stack

| Layer | Technology | Where |
|---|---|---|
| Frontend | React 19 + Vite 6, single-page app | `src/` |
| Hosting | Cloudflare Workers — Static Assets (SPA fallback) | `wrangler.jsonc` |
| Backend-as-a-service | Supabase (Postgres + Auth + Realtime) | hosted project `afkxawjhaoobdnegaekp.supabase.co` (V1; CLI linked; deployed bundle embeds it). Legacy project `yiwygvsqrcouqsjjtgiq` archived 2026-09-13 |
| Client server access | Supabase anon/publishable key only (no service-role anywhere) | `src/integrations/supabase/client.ts` |
| Database versioning | 16 applied migration files | `supabase/migrations/` |
| Local CLI | Supabase CLI config present (`config.toml`, project `OFF`, local port 54321) | `supabase/config.toml` |

## Runtime entry points

- `src/main.tsx` — top-level state machine: `initializing → error | signed-out (landing/auth) | onboarding | chat`.
  - If Supabase env vars are unset → dedicated "Configuration required." screen (`isSupabaseConfigured`).
- `src/components/auth/AuthForm.tsx` — sign in / create-account, username + password only (Google OAuth removed in the privacy pivot).
- `src/components/onboarding/OnboardingFlow.tsx` — 4-step onboarding: recovery → profile → country → interests.
- `src/components/chat/ChatShell.tsx` — main app shell: left nav (Home/Rooms/You), conversation + details rail, bottom nav + sheets on mobile.

## Services (pure logic, unit-tested)

| Service | Responsibility |
|---|---|
| `auth/service.ts` | `signIn`, `signUp` (uses `usernameToAuthEmail`) |
| `auth/username.ts` | canonicalize/validate username, derive deterministic auth email (`<username>@off.app`) |
| `auth/availability.ts` | `checkUsername` → idle/checking/available/unavailable/invalid via RPC `username_status` |
| `auth/strength.ts`, `auth/errors.ts`, `auth/recovery.ts` | password strength, safe error mapping, recovery notice copy |
| `chat/types.ts`, `chat/messages.ts`, `chat/senders.ts`, `chat/status.ts` | message shape, reconcile/group, sender name resolution, channel status labels |
| `navigation/layout.ts` | viewport breakpoints (320/767/1199), section grouping (world/country/interest/custom) |
| `onboarding/state.ts`, `progress.ts`, `interests.ts` | step routing, progress %, interest slugs + legality |
| `profiles/map.ts` | profile→name mapping helper |
| `rooms/permissions.ts` | `isDiscoverable` (removed), `canPostToRoom` |
| `utils/debounce.ts` | username availability debounce |

## Database schema (from migrations)

- Types: `room_kind` enum (`world` | `country` | `interest` | `custom`).
- Tables: `profiles`, `rooms`, `room_members`, `messages`, `dm_threads`, `user_interests`.
- Seeded rooms (migration 001): `world`, `cybersecurity`, `linux`, `programming`, `ai`, `ctf`, `science`, `hardware`.
- RPC functions: `handle_new_user`, `is_room_member`, `is_room_moderator`, `is_room_owner`, `require_authenticated`, `create_room`, `join_public_room`, `leave_room`, `get_or_create_dm_thread`, `can_access_thread`, `complete_onboarding`, `complete_profile`, `handle_country`, `set_onboarding_interests`, `acknowledge_recovery`, `username_status`, `validate_message_reply`, `protect_room_owner`, `guard_onboarding_state`, `guard_profile_identity`, `guard_message_immutable_fields`, `guard_profile_trusted_fields`.
- Triggers: profile auto-create, reply validation, owner protection, onboarding-state guard, identity guard, message-immutability guard, profile-trusted-fields guard.
- RLS is authoritative from `202609060005_authoritative_rls.sql` onward; later migrations only refine/guard.

## Authentication model (current)

- Username (3–32 chars, `[a-z0-9_]`) is canonicalized client-side.
- Supabase Auth still requires an email/identifier → OFF derives a deterministic non-deliverable email from the username (`usernameToAuthEmail`). This is the "internal pseudo-email" convention.
- Authentication is username + password only; OFF derives a deterministic non-deliverable email from the username (`usernameToAuthEmail`). This is the "internal pseudo-email" convention. Google OAuth was removed in the privacy-first pivot (code, tests, README). `supabase/config.toml` retains only generic OAuth provider boilerplate (unused).
- Password minimum 6 (matches `config.toml` `minimum_password_length = 6`), strength meter.
- Cross-checked client-side via a separately invented password, password is never compared to the username by the client.

## Security surface

- Client sends only anon/publishable key. Never a service-role credential.
- RLS enforced at DB: message send requires `sender_id = auth.uid()`; room reads gated by kind + membership; DM reads via `can_access_thread`.
- Content Security Policy, HSTS, `X-Frame-Options: DENY`, `Permissions-Policy`, nosniff shipped via `public/_headers` (honored by Workers Static Assets).
- No analytics/tracking/fingerprinting scripts.

## Data flows

- Onboarding → `complete_profile`/`handle_country`/`set_onboarding_interests` RPCs write the `profiles` row and add room memberships (incl. World and interest/country rooms).
- Chat → messages inserted optimistically with a client event id; Supabase Realtime broadcasts on `messages`; `reconcileMessage` replaces pending rows; groups by sender/room.
- DMs → `get_or_create_dm_thread` RPC returns a thread id; messages addressed to that thread only.

## Testing

- 9 Vitest files / 198 tests (unit + static config/source audits), `src/test/`.
- `scripts/smoke.mjs` (`npm run smoke`): boots production build via `vite preview` and renders it in headless Chrome; asserts assets, metadata, hydration, absence of uncaught errors.

## Deployment

- `npm run build` → `dist/` → Workers Static Assets (`assets.directory: ./dist`), SPA `not_found_handling`.
- Canonical public URL: `https://off.testingver.workers.dev/`.

## Known weak spots for the V1 privacy pivot

1. Identity is a username → deterministic pseudo-email; no invitation/connection model; usernames are not minimal information.
2. Every room kind and seeded interest/country rooms exist; the product aims for a single World + private conversations.
3. Onboarding collects country + interests before entering the product — target: create identity → privacy options → World (V1 redesign; code still 4-step today).
4. No message requests, blocking, disappearing messages, privacy settings, or account deletion flow (UI).
6. No E2EE; content is TLS + server-side plaintext in Supabase (honest claim: transport encryption only).
7. Recovery ceremony is a labeled placeholder, not a real backup.