# OFF — V1-MASTER-IMPLEMENTATION-PLAN.md

Governing build contract for the OFF V1 privacy-first release. This document is
the first executed deliverable of the master directive. It must stay green with
the code and the environment this release actually ships.

Status: **approved** 2026-09-14; Phase 0 in execution.

---

## 1. Envelope

| Field | Value |
|---|---|
| Project | OFF — Open Freedom Forum |
| Repository | `Mythtilla/OFF` (worktree `OFF-current`) |
| Branch | `main` |
| Live site | `https://off.testingver.workers.dev` (Worker `off`, account `9adb20cd…`) |
| Supabase V1 | `afkxawjhaoobdnegaekp` (eu-central-1) — the only project the app touches |
| Supabase archive | `yiwygvsqrcouqsjjtgiq` — must never be modified |
| Stack | React 19 + Vite 6, Cloudflare Workers Static Assets, Supabase (Auth/Postgres/RLS/Realtime) |
| Directive | MASTER V1 RESEARCH → DESIGN → IMPLEMENT → TEST → HARDEN → RELEASE |

## 2. Checkplan statements (evidence, not intent)

- [x] I read the master directive in full before writing this document.
- [x] I read the repository: `src/` (components, services, tests), `supabase/`
      (config, 16 migrations, seed), `docs/` (11 files), `scripts/`,
      `index.html`, `public/_headers`, `wrangler.jsonc`, `.env.local`,
      `README.md`, `package.json`.
- [x] I verified the environment separation: V1 live on a new Cloudflare
      account + new Supabase project; OLD archived and unreachable from tooling.
- [x] I verified the deployed bundle `index-uMVUTzio.js` serves the V1 URL with
      zero old-project references (ENVIRONMENTS.md, version `a9c484dc…`).
- [x] I will re-run the baseline gate (typecheck, lint, test, build, smoke)
      before any feature implementation and record results in this document.
- [x] I will not weaken RLS to make a feature easier; RLS stays authoritative.
- [x] I will not claim E2EE, anonymity, or zero-knowledge guarantees OFF does
      not deliver in V1.
- [x] I will produce a feature spec subsection (feature / reason / references /
      architecture / schema / RPC / UI / security / privacy / tests / deps /
      complexity / risk / release-version) for every shipped feature.
- [x] I will hard-stop on: destructive DB ops without written owner confirmation;
      ambiguous environment classification; cryptographic primitive selection;
      identity-architecture change; RLS bypass; third-party data collection;
      invasive telemetry; license-of-reference ambiguity.

## 3. Hard-stop conditions

Execution halts and the owner is consulted on any of:

1. Any `supabase db reset` / destructive RPC proposed against the **V1** hosted
   project without explicit written owner confirmation (the archive project is
   unconditionally forbidden).
2. Ambiguous target environment (no clear LOCAL/V1/OLD determination).
3. Any decision that effectively chooses a cryptographic primitive or protocol
   for data-at-rest protection beyond the current TLS-only baseline.
4. Any identity-architecture change (e.g., switching to device-local keys or a
   different auth provider) without prior review.
5. Any weakening of RLS policies, triggers, or the owner/message-id integrity
   invariants.
6. Any plan step that silently offloads secrets to the client or introduces a
   service-role key path into the bundle.
7. Any third-party data sharing or new analytics/fingerprinting surface.
8. Any use of a reference project's code/logos that is not clearly licensed for
   that use.

## 4. Baseline snapshot (verified 2026-09-14)

- Migrations 001→016 applied to V1; seed applied → **1 World room, 0 other
  rooms, 0 users, 0 messages** (after the provisional test user was rechecked;
  owner account `mythtilla` exists).
- Auth transport: `usernameToAuthEmail` → `<username>@off.app`
  (`AUTH_EMAIL_DOMAIN = "off.app"`). Hosted "Confirm email" set **OFF** so
  anonymous self-signup returns an immediate session.
- `wrangler.jsonc`: `name = off`, `account_id = 9adb20cd…`, SPA assets from
  `./dist`.
- Gate baseline (recorded after re-run, see §6): typecheck ✅, lint ✅,
  tests ✅ (~198), build ✅, smoke ✅.
- Working tree === committed state at the branch tip `6d8dc95`.

## 5. Feature inventory — V1 REQUIRED ("This release")

| # | Feature | DB/RPC | UI | Tests | Release |
|---|---|---|---|---|---|
| F1 | Anonymous self-signup success (confirm-email OFF, immediate session) | none new (hosted setting) | existing AuthForm | live probe + static | V1 |
| F2 | Onboarding → identity → privacy options → World; country/interests gate removed (RPCs retained) | none new | OnboardingFlow + privacy-options step | foundation/resilience updates | V1 |
| F3 | Navigation: mobile Home/Chats/Communities/You; desktop left rail; World pinned | none | ChatShell + layout helpers | navigation-layout, ui-smoke | V1 |
| F4 | Messaging completeness: edit own, soft-delete own, reply-to, grouping, timestamps, indicator | edit/delete RLS exist; reply via `validate_message_reply` | reply/actions UI, indicator pill | chat-logic, ui-smoke | V1 |
| F5 | DMs as message requests: inbound = Request → accept→thread / reject / block | `dm_requests` table + RPCs; extend `can_access_thread`; realtime on requests | Requests inbox + accept/reject/block | new request-flow tests; manual 2-user | V1 |
| F6 | Blocking, server-enforced | `blocks` table + RLS + request/thread guard | block stub | RLS static tests | V1 |
| F7 | Rate limits, privacy-preserving, DB-level | guards on `username_status`, `create_room`, requests | surface errors | unit + manual | V1 |
| F8 | Account deletion flow (documented; V1.1 executes RPC) | deletion RPC (cascades exist) | UI stub | manual | V1 |

## 6. Research matrix

| Feature family | Reference | OFF decision |
|---|---|---|
| DMs-as-requests | Session "Message Requests" | Stranger DM → request inbox; accept/reject/block |
| Accept/reject/block | SimpleX conversation requests | Request lifecycle is server-RLS-enforced |
| Rate limits | Supabase Auth `rate_limit` config + Postgres guard patterns | DB-level guards; no tracking tables |
| Identity verification codes (V1.1) | Signal safety numbers / SimpleX security codes | Short code UI in V1.1, crypto binding at E2EE |
| Disappearing messages / E2EE (V1.1+/future) | E2EE-ROADMAP M1 via established library | Never hand-rolled crypto; key recovery designed first |

## 7. Dependency graph

```
hosted confirm-email OFF ──────────────▶ F1 (anonymous signup) ─▶ live verification
onboarding RPCs (exist) ──▶ F2 ── requires F1 session flow
blocks table (F6) ──▶ request system (F5) ──▶ DM messages
messages schema (exists) ──▶ F4 (independence: no new table)
navigation (F3) ── independent of schema; drives ChatShell refactor
rate limits (F7) ── guards F1/F5 spam; independent otherwise
account deletion (F8) ── independent; cascades already in schema
```

## 8. P0/P1 risks

- **P0** Anonymous signup can introduce spam → mitigated by F7 before open
  registration, and by keeping requests opt-in (F5).
- **P0** RLS regressions on new `dm_requests`/`blocks` tables → mirrored static
  tests + manual 2-user matrix in V1-TEST-PLAN.
- **P1** Realtime payload/Inbox metadata leaks on requests → minimal payloads,
  no typing/presence defaults.
- **P1** V1 data-loss vectors on account deletion → cascades reviewed per
  DATA-OWNERSHIP; deletion is reversible-pending-owner-gate in V1.
- **P1** Workstation memory ceiling (3.5 GiB) → gate run sequentially; no
  parallel builds/tests.

## 9. Architectural changes (V1)

1. Auth transport fixed to `@off.app`; confirm-email OFF; documented in
   ENVIRONMENTS.md and IDENTITY-DESIGN.md.
2. Two-step onboarding (identity → privacy options → World); country/interests
   tables retained for future, no longer gating entry.
3. New `dm_requests` + `blocks` tables with hardened RLS and server-enforced
   write paths.
4. Four-tab navigation model (Home/Chats/Communities/You); desktop three-column.
5. Deploy pinned to account `9adb20cd…`; canonical URL `off.testingver.workers.dev`.
6. `docs/security/*`, `docs/privacy/*`, `docs/research/*` folders introduced
   and kept in sync with shipped code.

## 10. Phase roadmap

- **Phase 0 (baseline + stabilization):** write this plan; run gate; verify
  anonymous signup; commit + push stabilization set; sweep stale docs.
- **Phase 1 (This release):** F1→F8 in dependency order, each with tests +
  docs + a deploy after each cluster.
- **Phase 2 (V1.1):** block-list management UI, report-to-moderation,
  invite/QR codes, findability toggle, privacy-settings screen (real toggles
  only), data export, account-deletion execution RPC.
- **Phase 3 (future):** E2EE M1 via established library (key-recovery designed
  first), disappearing messages scoped to E2EE, community directory.
- **Exit gate:** V1-RELEASE-CHECKLIST binary-pass as executed; V1-TEST-PLAN
  Manual items recorded or explicitly UNVERIFIED; docs match code; commit only
  on explicit request.

## 11. Gate results

| Step | Result | Date |
|---|---|---|
| typecheck `tsc -b` | ✅ | 2026-09-14 |
| lint `eslint .` | ✅ | 2026-09-14 |
| test `vitest run` | ✅ 198/198 | 2026-09-14 |
| build `tsc -b && vite build` | ✅ `index-uMVUTzio.js` | 2026-09-14 |
| smoke `node scripts/smoke.mjs` | ✅ PASS | 2026-09-14 |
| live anonymous signup probe | PENDING | — |
| push to `Mythtilla/OFF` | PENDING | — |