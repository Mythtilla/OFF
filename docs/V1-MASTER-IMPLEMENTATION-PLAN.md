# OFF — V1-MASTER-IMPLEMENTATION-PLAN.md

Governing build contract for the OFF V1 privacy-first release.

Revision: **2026-09-16** (this version supersedes the 2026-09-14 plan; every
previous commit/revision is retained in git history). This plan stays green
with the code and the environment this release actually ships.

Status: Phase 0.2 **COMPLETE** — Phase 0.3 (architecture refactor) next.

| Step | Date | Result |
|---|---|---|
| `npm run typecheck` | 2026-09-16 | ✅ clean |
| `npm run lint` | 2026-09-16 | ✅ clean |
| `npm test` (198/198) | 2026-09-16 | ✅ **GREEN** (fixed: chain assertion now includes `202609160004`) |
| `npm test` (203/203) | 2026-09-16 | ✅ **GREEN** (Phase 0.2: 5 new regression + universal RLS-mirror tests added) |
| `npm run build` | 2026-09-16 | ✅ — `dist/assets/index-vWwOXwnl.js` (445.93 kB / 127.97 kB gz), `index-CQl2k59N.css` (15.10 kB / 3.82 kB gz) |
| `npm run smoke` | 2026-09-16 | ✅ 15/15 PASS (headless Chrome) |
| Live bundle | 2026-09-16 | ⚠️ deployed `index-uMVUTzio.js` is one revision behind current build `index-vWwOXwnl.js` (pending re-deploy) |

---

## 1. Envelope

| Field | Value |
|---|---|
| Project | OFF — Open Freedom Forum |
| Repository | `Mythtilla/OFF` (worktree `OFF-current`) |
| Branch / HEAD | `main` @ `ce06468` (2026-09-14) + **uncommitted WIP** (see §2.2) |
| Live site | `https://off.testingver.workers.dev/` — Worker `off`, Cloudflare account `9adb20cd…`, subdomain `testingver` |
| Supabase **V1** (active) | `afkxawjhaoobdnegaekp` (eu-central-1). The only project the app touches. CLI linked (`supabase/.temp/project-ref`). |
| Supabase **archive** | `yiwygvsqrcouqsjjtgiq` — must never be modified. |
| Stack | React 19 + Vite 6, TypeScript, Cloudflare Workers Static Assets, Supabase (Auth / Postgres / RLS / Realtime) |
| Directive | MASTER V1 RESEARCH → DESIGN → IMPLEMENT → TEST → HARDEN → RELEASE |

**Environment verification performed this session (2026-09-16):**

- `.env.local` `VITE_SUPABASE_URL` = `https://afkxawjhaoobdnegaekp.supabase.co` (**V1**). Publishable/anon key only; no service-role key line present.
- CLI `supabase/.temp/project-ref` = `afkxawjhaoobdnegaekp` (**V1**). Not linked to the archive project.
- Live Worker bundle `index-uMVUTzio.js` embeds `https://afkxawjhaoobdnegaekp.supabase.co` — zero references to the archive project.
- **Publishable-key REST probe against V1:** `profiles` → HTTP 200; `dm_requests` → HTTP 404; `blocks` → HTTP 404. Consequence: migrations `202609160001`–`202609160004` have **not** been pushed to the hosted V1 database. The defects in those migrations (§3) therefore have **not shipped** to production yet — they exist only in the working tree. This is the single most important fact of this revision.
- **Tooling gap:** no `supabase` CLI and no `docker` on this workstation. The local `supabase db reset` verification path (§12) is therefore **blocked until the operator installs the CLI (and Docker, or points at a hosted target)**. Remote verification is limited to what the publishable key can do.

## 2. Baseline snapshot (verified 2026-09-16)

### 2.1 Gate results (this session)

| Step | Result | Evidence |
|---|---|---|
| `npm run typecheck` | ✅ | clean |
| `npm run lint` | ✅ | clean |
| `npm test` (198/198) | ✅ **GREEN** | chain assertion fixed (Phase 0.1); all 9 suites pass |
| `npm run build` | ✅ | `index-vWwOXwnl.js` (445.93 kB), `index-CQl2k59N.css` (15.10 kB) |
| `npm run smoke` | ✅ | 15/15 asserts PASS in headless Chrome |
| Live bundle check | ⚠️ | deployed `index.html` references `index-uMVUTzio.js` + `index-CQl2k59N.css`; current build emits `index-vWwOXwnl.js`. **Live Worker is one JS revision behind the current working tree.** |

**The gate is GREEN.** Phase 0.1 complete. Feature work proceeds per Phase 0.2 (§9).

### 2.2 Working-tree WIP (uncommitted, authored 2026-09-16, not deployed)

| Path | State | Content |
|---|---|---|
| `supabase/migrations/202609160001_dm_requests.sql` | staged | `dm_requests` table — **no RLS** |
| `supabase/migrations/202609160002_blocks.sql` | staged | `blocks` table — **no RLS** |
| `supabase/migrations/202609160003_privacy_flags.sql` | untracked | adds `profiles.discoverable`, `profiles.contactable` (default false) |
| `supabase/migrations/202609160004_rls_privacy_policies.sql` | untracked | policies referencing a **non-existent column** |
| `src/services/auth/username.ts` | modified | `validateUsername` empty-safe + non-deterministic `anon-…@off.app` fallback in `usernameToAuthEmail` |
| `src/test/security-audit.test.ts` | modified | chain test extended to 160001–003 (not 004) |

This WIP is the previous agent's attempt at message-requests + blocking + privacy
flags. It is **not deployable as written** and must be reworked (§3, Phase 0.2).

### 2.3 Hosted V1 database state (verified this session)

Publishable-key REST probe against `afkxawjhaoobdnegaekp`:

| Table | HTTP | Rows |
|---|---|---|
| `profiles` | 200 | 0 |
| `rooms` | 200 | **0** |
| `messages` | 200 | 0 |
| `room_members` | 200 | 0 |
| `dm_threads` | 200 | 0 |
| `user_interests` | 200 | 0 |
| `dm_requests` | **404** | — (table absent) |
| `blocks` | **404** | — (table absent) |

**Consequences:**

- Schema for migrations 001–016 is applied; the data plane is empty. The **World-only** clean-DB target is enforced by the V1 reset primitives already in the repo — `supabase/seed.sql` (local `db reset`, deletes non-World rooms and asserts exactly one World row) and `scripts/reset-to-world.sql` (for an existing database, also clears accounts) — because migration 001 as written seeds World plus 7 interest rooms (`202609060001_off_mvp.sql:20`). **Any fresh-reset release evidence MUST use these primitives**, never a bare migration re-apply.
- Migrations `202609160001`–`202609160004` are **absent from hosted** — the reworked batch (§6.1/§6.2) will be the first push of the request/block/privacy layer, and must be pushed only after the linked-project confirmation (§13).

---

## 3. Critical findings from the independent source audit

Each finding below was verified by reading the file listed (not by trusting prior
claims). Priorities: P0 = blocks release or is a live vulnerability class,
P1 = must fix in this release, P2 = must decide/fix before V1 ships.

### P0-A — Migration `202609160004` cannot apply

`supabase/migrations/202609160004_rls_privacy_policies.sql:6,11,17` reference
`user_id = auth.uid()` as a predicate on `public.profiles`. The `profiles` table
primary-key / identity column is **`id`** (migration `202609060001:4`); there is
no `user_id` column. `CREATE POLICY` resolves identifiers at creation time, so
the migration raises `column public.profiles.user_id does not exist` and **the
whole migration fails**. Verified the column set: `profiles(id, username,
display_name, avatar_url, country_code, created_at, onboarding_completed, bio,
country_source, recovery_acknowledged_at, profile_completed_at,
country_handled_at, interests_handled_at, discoverable, contactable)`.

### P0-B — `dm_requests` and `blocks` have no RLS

`202609160001_dm_requests.sql` and `202609160002_blocks.sql` never call
`enable row level security`. With RLS disabled, API roles can read and write
these tables subject only to global grants (Supabase exposes new `public`
tables to anon/authenticated by default). Effects if pushed as-is:

- any client can **read the full block graph** (who blocked whom — a privacy leak),
- any client can **forge/delete block rows** (impersonate another user blocking/unblocking),
- any client can **read another user's inbound message requests** and mark them accepted/rejected/anything.

These tables are exactly the future security boundary for private communication;
leaving them open is a P0 authorization + privacy defect. Also: FKs reference
`auth.users(id)` directly (rest of schema references `public.profiles(id)`), and
`dm_requests.id` / `created_at` have **no defaults**, `status` is unvalidated free text.

### P0-C — `discoverable` / `contactable` would be visual-only toggles

Even if `202609160004` applied, the authoritative policy reset
(`202609060005:5`) leaves `profiles_read … using (true)` in force. Postgres
RLS policies are **OR-ed**, so adding `profiles_discoverable_read
using (discoverable = true or id = auth.uid())` does not restrict anything:
every authenticated user can still read every profile via `profiles_read`.
Same for `contactable`. A shipped toggle that does not change server behavior
violates the directive's "no visual-only privacy toggles" rule. The fix must
either drop/narrow `profiles_read` or make these flags effectful at the RLS layer.

### P1-1 — No request/block lifecycle RPCs, no enforcement

`get_or_create_dm_thread` (`202609060005:19`) has **no** request-state check and
**no** block check: today any authenticated user can open a thread to any other
user directly. There are no `send_dm_request` / `accept_dm_request` /
`reject_dm_request` / `block_user` / `unblock_user` RPCs, no `dm_requests` realtime
publication, and no thread-side block gate. The whole "DMs as message requests +
server-enforced blocking" feature family must be designed as RPC + RLS, not as
open-table CRUD.

### P1-2 — Test drift and missing RLS-mirror coverage

- `src/test/security-audit.test.ts` chain assertion omits `202609160004` (the cause of the red gate).
- The static test "enables RLS on the four core tables" (`security-audit.test.ts:59`) covers only `profiles, rooms, room_members, messages`. A policy **must** be added that asserts every table in `public` has RLS enabled and every new table has the expected policies — this is the test that would have caught P0-B.

### P1-3 — Live Worker is one JS build behind the working tree

Deployed `index-uMVUTzio.js` vs current-build `index-vWwOXwnl.js`. Harmless for
the WIP (which must not ship at all), but re-deploys and re-verifications are a
release-gate step, and bundle hashes must be recorded as evidence.

### P2-1 — `usernameToAuthEmail` anon fallback semantics

`src/services/auth/username.ts` now returns `anon-<time36>@off.app` when
`username` is empty. This is non-deterministic across attempts, can collide if
the same user retries, and muddies the documented "deterministic pseudo-email
derived from the username" identity contract. **Decision needed** (see hard-stops):
keep the anon transport (requires explicit documentation + uniqueness/retry
handling) or revert to throwing on empty input.

### P2-2 — Onboarding is still the 4-step gate (recovery → profile → country → interests)

Target for V1 is **identity → privacy defaults → World**, no country/interests
questionnaire before entry. `complete_onboarding`
(`202609060010`) still requires country membership; `OnboardingFlow` still
routes through all four steps; `CountryStep` is a "handled" stub screen. Schema
changes needed: a privacy-defaults step + rewritten completion guard, keeping
the old RPCs only if harmless.

### P2-3 — ChatShell does not meet the V1 surface

- Navigation is `Home / Rooms / You`, not the target `Home / Chats / Communities / You`.
- No message **edit / delete / reply / copy** actions in the UI (schema + guards exist).
- Realtime channel subscribes to **INSERT only** (`ChatShell.tsx:171`), so edits/deletes do not propagate to other clients.
- No requests inbox; no You section (only the avatar sheet); no blocks UI.

### P2-4 — No app-level rate limiting

`username_status` is granted to `anon` (`202609070001`) with no counter. No
limits on request creation, thread creation, or room creation beyond provider
defaults. V1 needs privacy-preserving DB-level guards (§8).

### P2-5 — Documentation program not yet created

`docs/security/*`, `docs/privacy/*`, `docs/research/*` do not exist. `research/signal`
and `research/simplex` directories are **empty**. Required artifacts per §50–§52
must be produced alongside the features.

---

## 4. Research matrix (feature family → reference repositories)

"References" are study targets, not code donors (respect licenses; re-implement
behavior with OFF's architecture). For each family the research note file is
created under `docs/research/` before implementation.

| Family | Priority references | Inspect | OFF decision (V1) | Research file |
|---|---|---|---|---|
| Identity / auth | `simplex-chat/simplex-chat` (identity model), `signalapp/Signal-Desktop` (username/findability), `mollyim/mollyim-android` (profiles), briar | identity docs, `apps/` profile code, message-request handlers | Keep username+password; username immutable; pseudo-email internal-only; **no searchable-by-default identity** | `identity.md` |
| Recovery | Signal backup/device behavior, SimpleX local data, `element-hq/element-web` key backup docs | recovery/device docs | V1 = honest placeholder, never presented as real; document model | `recovery.md` |
| Onboarding | Signal first-run, SimpleX profile, community apps | onboarding screens/copy | identity → privacy defaults → World | `mobile-ux.md` (shared) |
| Conversation (World) | `zulip/zulip` (topics), `mattermost/mattermost` (channel UX), `element-hq/element-web` (timelines) | channel/message code | World = single public room; server-read (not E2EE, labeled) | `messaging.md` |
| Requests | SimpleX accept/reject/block, Signal message requests | request flow code | request inbox; accept→thread / reject / block; RPC+RLS enforced | `messaging.md` |
| Blocking | Signal block semantics, Discourse/matrix moderation | block + moderation flow | server-enforced across request/thread/message paths; never a UI filter | `moderation.md` |
| Privacy settings | Signal settings, SimpleX privacy | settings screen code | every toggle has a real RLS/realtime effect or is OFF/labeled | `privacy.md` |
| Rate limiting | Supabase auth rate-limit config, postgres guard patterns, Discourse abuse controls | throttle code | DB-level guards; no tracking tables | `abuse.md` |
| Chat UX / themes | Signal appearance, Mattermost/Elements themes | theme/metrics scope | OFF's own theme language; local storage; no GPU-heavy effects | `themes.md`, `mobile-ux.md` |
| Realtime | Signal, Matrix `matrix-org/synapse` realtime | delivery/ordering semantics | optimistic insert + INSERT/UPDATE/DELETE reconcile; honest status labels; no typing/presence defaults | `realtime.md` |
| Communities (future) | Matrix spaces/rooms, Zulip streams, Discourse categories | hierarchy + moderation | schema preserved; **World only** in V1; no seeded fake communities | `community.md` |
| E2EE (V2) | Signal protocol docs, SimpleX protocol, Matrix/Olm/Megolm docs | protocol + key-recovery design | not in V1; curriculum + library shortlist only; never hand-rolled crypto | `e2ee.md` |
| Attachments (future) | Signal attachment pipeline, Matrix media, Mattermost file handling | MIME/sniff/metadata/caps | explicitly off in V1 (documented) | `storage.md` |
| Accessibility | — | — | 44px targets, aria-live, one h1/view, focus-visible, reduced-motion | `accessibility.md` |

## 5. Feature inventory — V1 REQUIRED

Fields per directive §60: feature / reason / references / architecture / schema /
API+RPC / UI / security model / privacy impact / tests / dependencies /
complexity / risk / release version. High-risk families get full blocks (§6);
others are covered in the matrix below.

Legend — scheme: `world` = public, `id` = identity, `req` = request/block,
`priv` = privacy, `chat`; complexity: L/M/H; risk: L/M/H (with P-level).

| # | Feature | Reason | Architecture / schema delta | API + RPC | UI | Security model | Privacy impact | Tests | Release | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| F0 | Baseline green gate | must ship on a passing gate | fix chain test; CI-like gate command | none | none | n/a | n/a | security-audit | V1 | P1 |
| F1 | Auth + identity hardening | minimal identity, no enumeration | none (exists) | `username_status` rate-limit wrapper | existing AuthForm | RLS authoritative; no service role | pseudo-email only; username internal-in-app | existing suite + new rate-limit tests | V1 | L |
| F2 | Onboarding → privacy defaults → World | reach value fast, no questionnaire | drop country/interests gates; `discoverable`,`contactable` effectful RLS; new privacy step write path | `set_privacy_defaults`, rewritten `complete_onboarding`, drop country requirement | new 2-step flow | trusted-state guards stay; RLS-effectful flags | collects privacy *preferences*, not identity data | foundation + ui-smoke + RLS static | V1 | M |
| F3 | World messaging completeness (edit/delete/reply/copy) | mature public conversation | none (schema+guards exist) | reuse existing; add UPDATE/DELETE realtime | message actions, reply composer, indicator | author-only edit/delete via existing RLS+guards; reply validated server-side | message bodies remain server-readable (labeled) | chat-logic + RLS static + manual 2-user | V1 | M |
| F4 | Realtime reliability | edits/deletes must propagate | subscribe INSERT+UPDATE+DELETE; stale-channel cleanup; logout cleanup | none | status indicator stays honest | no metadata leaks added | no typing/presence | resilience + manual 2-tab | V1 | M |
| F5 | Message requests | stranger DMs must be permissioned | **DONE**: 160001 (`dm_requests` + RLS + defaults + CHECK + realtime) | **DONE**: `send_dm_request`,`accept_dm_request`,`reject_dm_request` (160005) | Requests inbox in Chats | RLS-scoped; recipient-only writes; rate-limited sender | no content in request payload | unit + RLS static + manual 2-user | V1 | H |
| F6 | Blocking, server-enforced | block must be a real denial | **DONE**: 160002 (`blocks` + RLS) + 160005 (`can_access_thread` block override, thread/request gating) | **DONE**: `block_user`,`unblock_user` | block in request/profile UI | enforced in every private path; blocks not enumerable | block list is private data | adversarial + RLS + manual | V1 | H |
| F7 | Privacy settings (real toggles) | no visual-only switches | **DONE**: 160004 narrowed `profiles_read` + `resolve_sender_names` carve-out RPC | settings write via existing `profiles_update_self` | Privacy item in You | RLS-authoritative visibility | discoverability is explicit | RLS static (must prove effect) | V1 | H |
| F8 | You section (Profile/Security/About) | self-management surface | none new | existing `complete_profile` + password change | You screen shell | self-only writes | — | ui-smoke | V1 | L |
| F9 | Account deletion (documented RPC, owner-gated) | user data control | deletion RPC (cascades exist; auth delete is destructive) | `delete_account` RPC (owner confirms execution) | stub + copy | session invalidation; no orphan data | define what remains (others' copies) | unit + manual on V1 | V1 docs / V1.1 exec | H |
| F10 | Rate limiting (DB-level) | abuse resistance without tracking | guard functions on signup/status/requests/threads | extend existing guards | surface errors | server-enforced | no tracking tables; counters transient | unit + manual | V1 | M |
| F11 | Privacy/security documentation | honest claims | docs only | none | none | n/a | inventory + operator visibility | static (no forbidden strings) | V1 | L |
| F12 | Deployment hardening + smoke re-verify | reproduceable deploy | none | none | none | headers verified | none | smoke + live probes | V1 | L |

### Deferred (documented, not V1)

`V1.1` — connection/QR codes (research first), block-list management UI,
report-to-moderation, profile sharing link `/u/<username>`, data export,
disappearing messages (honest-limits design), opt-in typing/read-receipts/
presence, sessions list/revoke UI, avatar upload (server-side re-encode),
core V1 deletion execution.
`V2` — real E2EE for private conversations via an established audited library,
cryptographic identity + verification codes, key backup/recovery design first,
encrypted attachments. World/communities remain server-readable by design.

## 6. Feature deep-dives (high-risk families)

### 6.1 F5+F6 tram-message requests and server-enforced blocking

**Feature:** stranger → outbound DM is delivered to the recipient's **Requests**
inbox; recipient accept (open thread) / reject (no thread) / block
(server-enforced denial in every private path).

**Reason:** permissive thread creation today (`get_or_create_dm_thread`) lets any
authenticated user message anyone. SimpleX and Signal both make contact opt-in.
OFF's model: *private contact is permissioned, not assumed.*

**References:** `simplex-chat/simplex-chat` connection/invite flow;
`signalapp/Signal-Desktop` messageRequests/block state machine.

**Architecture:** RLS-authoritative. No client can mutate `dm_requests`/
`blocks` directly. All state changes flow through SECURITY DEFINER RPCs
(`search_path=public`, `require_authenticated()`), mirroring the established
`join_public_room`/`complete_profile` pattern. Realtime on `dm_requests` is
recipient-scoped; payload carries sender id + status only (no message body).

**Schema (rework of 160001/160002):**

```
dm_requests(
  id uuid pk default gen_random_uuid(),
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at  timestamptz not null default now(),
  constraint dm_requests_sender_not_self check (sender_id <> recipient_id),
  unique (sender_id, recipient_id)  -- one live request per pair
)
-- RLS: enable
-- select: recipient reads own inbound; sender reads own outbound status
-- all mutations via RPCs only (no direct insert/update/delete policies)

blocks(
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
)
-- RLS: enable; select returns only rows where blocker_id = auth.uid()
-- insert/delete via RPCs only
```

**API + RPC:**

- `send_dm_request(target uuid)` → rejects if blocked (either direction), self,
  or a request already pending; rate-limited (F10). Returns request id.
- `accept_dm_request(request uuid)` → owner/recipient only; creates the
  `dm_threads` row (canonical `least/greatest`), marks request `accepted`.
- `reject_dm_request(request uuid)` → owner/recipient only; marks `rejected`.
- `block_user(target uuid)` / `unblock_user(target uuid)` → owner only; also
  rejects/cancels any pending request to the target.
- `get_or_create_dm_thread(target uuid)` **modified**: now requires an existing
  accepted request or an already-existing thread, and returns a hard error if a
  block exists in either direction.
- All paths call `require_authenticated()`; mutations revoked from `public`,
  granted only to `authenticated`.

**Security model:** the block predicate is evaluated server-side in every private
path (request creation, thread creation, thread message insert), plus at the RLS
layer for API-direct SELECTs. Realtime payloads never contain private message
bodies; request events are recipient-only.

**Privacy impact:** block list is private to its owner (RLS select returns only
own rows); nobody can enumerate who blocks whom; request inbox does not leak
message content.

**Tests (per directive §12/§13/§14, at minimum):** send/accept/reject/block/unblock
lifecycle; blocked-sender API + realtime + request bypass attempts; race between
block and message; blocked user profile access; duplicate/concurrent request;
unauthorized accept (user C tries to accept A's request to B); RLS static
assertions that every public table has RLS and the new tables have the exact
expected policies; P0-B regression test.

**Dependencies:** F10 (rate limits) for request-send; F7 privacy flags for
"contactable" gating of `send_dm_request`.
**Complexity:** H. **Risk:** H (P0/P1 class if hand-rolled). **Release:** V1.

### 6.2 F7 — privacy flags with a real effect

**Feature:** `discoverable` and `contactable` actually change server behavior.

**Reason:** P0-C proves today's draft would be visual-only.

**References:** Signal findability toggle; SimpleX discoverability UX.

**Architecture:** the authoritative RLS reset (005) established `profiles_read … using (true)`. For V1 the profile read model becomes:

- `profiles_read` narrowed to `using (id = auth.uid() or discoverable)` — a user's
  own profile is always visible to its owner; **other** profiles are visible only
  when the owner has set `discoverable = true`.
- `send_dm_request` additionally refuses when `contactable = false` **and** the
  sender is not an existing connection (no accepted request). This makes
  `contactable` effectful at the boundary it controls.
- Sender-name resolution for World must keep working for non-discoverable users:
  the client resolves sender names via a **server-side RPC** (`resolve_sender_names(ids)`)
  that returns only profiles the caller may read plus World-relevant senders,
  rather than the current browser `select * from profiles` (which, under narrowed
  RLS, would drop names OFF still needs to render public messages). **Design note:**
  World sender names are public message metadata; the policy above must carve out
  the minimal "sender label" read (e.g. a `world`-scope RPC returning
  `id, username, display_name` for senders who posted in rooms the caller can read).

**API + RPC:** `set_privacy_flags(discoverable boolean, contactable boolean)`
(guarded, self-only). **Tests:** RLS static + live two-user matrix proving a
non-discoverable user is not visible to B while still rendered in World; blocked/
deleted account profiles behave per policy.

**Complexity:** M. **Risk:** H (privacy semantics + world-name rendering interplay). **Release:** V1.

### 6.3 F2 — onboarding redesign

**Feature:** create identity → set privacy defaults → enter World.

**Reason:** P2-2; the current 4-step gate collects country/interests before value.

**Schema:** any step that is optional is removed from the completion guard.
`complete_onboarding` no longer requires country membership. `discoverable`/
`contactable` become the privacy-defaults output columns and are honest only once
F7 lands (both default `false` = invisible + not contactable).

**API:** `set_privacy_defaults(discoverable, contactable)` sets flags and the
privacy-handled timestamp; `complete_onboarding` requires identity +
privacy-handled + World membership only.

**UI:** two-step flow; World is the first destination. Old step components are
removed or retained dead (never shipped).

**Tests:** new-user, return-user, refresh each step, browser back, duplicate
submit, trusted-state bypass, RLS bypass, `nextOnboardingStep`/progress parity.
**Complexity:** M. **Risk:** M. **Release:** V1.

### 6.4 F9 — account deletion (documented, owner-gated)

**Feature:** delete account RPC that removes account-scoped server data and
invalidates sessions; UI shows exactly what is removed and what may remain on
other devices.

**References:** SimpleX local data ownership; Signal deletion behavior;
`DATA-OWNERSHIP.md`.

**Architecture:** deletions cascade through existing FKs (`profiles` → messages,
`room_members`, `dm_threads`, `blocks`, `dm_requests`, `user_interests`). The
RPC runs as SECURITY DEFINER, calls `auth.admin`-level deletion only via a
path the owner executes (hosted auth deletion is destructive and irreversible;
**hard-stop**: execution against hosted requires written owner confirmation;
V1 ships doc + UI stub, V1.1 executes).

**Tests:** normal delete; failed delete; session invalidation; direct API after
deletion; race with message send/block/DM; profile link after deletion.
**Complexity:** M. **Risk:** H (destructive). **Release:** docs V1, execution V1.1.

### 6.5 F10 — privacy-preserving rate limits

**Feature:** DB-level guards on `username_status`, `send_dm_request`, request
accept/reject, `create_room`, thread creation.

**References:** Supabase `[auth.rate_limit]` config (already present in
`supabase/config.toml:196-210`); Postgres advisory-lock/counter guards; no
tracking tables.

**Architecture:** short-lived server-side counters (a `rate_counters` table with
TTL cleanup, or per-user guard function counters), enforced inside the guarded
RPCs. Never IP-based analytics; never log identifiers beyond the session uid.
**Tests:** burst, sustained, concurrent, retry storm, false-positive control.
**Complexity:** M. **Risk:** M. **Release:** V1.

---

## 7. Dependency graph

```
F0 (green gate) ──► everything
F1 auth/username_status ──► F2 onboarding (needs account)
F7 privacy flags (RLS) ──► F2 (privacy defaults step)
F2 onboarding ──► World entry (F3)
F10 rate limits ──► F5 send_dm_request / F1 username_status
F5 requests ──► F6 blocking ──► F3 (thread send gating)
F5 + F6 ──► F4 realtime (request events + blocked-channel delivery constraints)
F8 You / F11 docs / F12 deploy: independent
F9 deletion: independent; requires F6 (blocks/requests cleanup) + F5
```

Ordering rule (directive §53): do not implement a later phase while a prior
security-critical phase is unstable. Requests/blocks (F5/F6) and privacy flags
(F7) are the critical path; messaging completeness (F3/F4) is independent and can
proceed in parallel.

## 8. P0/P1 risk register

| ID | Finding | Severity | Mitigation | Status |
|---|---|---|---|---|
| P0-A | migration 160004 cannot apply (`user_id` doesn't exist) | P0 | rewrite 160003/160004 together (effects: flags + narrowed profiles policy + world-name carve-out) | **FIXED** (Phase 0.2) |
| P0-B | `dm_requests`/`blocks` run without RLS | P0 | rework both tables with RLS + RPC-only mutation (§6.1); add universal RLS-mirror test | **FIXED** (Phase 0.2) |
| P0-C | discoverable/contactable are visual-only | P0 | narrow `profiles_read`; effectful `contactable` in `send_dm_request` (§6.2) | **FIXED** (Phase 0.2) |
| P1-1 | no request/block RPCs + open `get_or_create_dm_thread` | P1 | full request/block lifecycle RPCs + thread gating | **FIXED** (Phase 0.2: `send_dm_request`, `accept_dm_request`, `reject_dm_request`, `block_user`, `unblock_user`, gated `get_or_create_dm_thread`) |
| P1-2 | red gate + missing RLS-mirror coverage | P1 | fix chain test; add universal RLS assertions | **FIXED** (Phase 0.1 + 0.2: chain test green, universal RLS test + 5 regression tests added) |
| P1-3 | live bundle behind working tree | P1 | deploy + hash-record after each cluster | pending deploy action |
| P1-4 | Toolkit absent (no CLI/Docker) | P1 | operator installs Supabase CLI (+ optional Docker) so §12 local reset is available | operator |
| P2-1 | anon pseudo-email fallback semantics | P2 | decision record (§13 hard-stop) | owner |
| P2-2 | 4-step onboarding gate | P2 | §6.3 | none |
| P2-3 | ChatShell surface (nav/actions/INSERT-only realtime) | P2 | F3/F4 work; nav → Home/Chats/Communities/You | none |
| P2-4 | no rate limiting | P2 | §6.5 | none |
| P2-5 | docs program absent | P2 | §11 | none |

## 9. Architectural changes required before feature work

1. **Migration tuple 160001–160005 reworked as a single, coherent,
   deployable migration batch** (requests + blocks + privacy + lifecycle RPCs).
   **DONE in Phase 0.2.** Push to hosted still pending linked-project
   confirmation (§13) — the batch is not yet deployed.
2. **Universal RLS mirror test** — every `public` table has RLS on and
   exactly-documented policies. **DONE in Phase 0.2** (`security-audit.test.ts`).
3. **Profile read model narrowed** (discoverable) **with a World sender-name
   carve-out RPC** so public conversation stays renderable while profiles become
   opt-in-visible. **DB side DONE in Phase 0.2** (`160004` +
   `resolve_sender_names`); **frontend switch from `from("profiles")` to
   `resolve_sender_names` is still pending** (Phase 0.3) — the client must call
   the RPC for World sender labels or non-discoverable senders will stop
   resolving after the DB push.
4. **Thread access re-gated** behind request state + blocks; direct
   `get_or_create_dm_thread` persona removed. **DONE in Phase 0.2** (`160005`).
5. **Realtime contract extended** to INSERT+UPDATE+DELETE with payload rules
   (minimal fields; no DM bodies in request events). `dm_requests` added to the
   realtime publication in Phase 0.2; **message-channel INSERT/UPDATE/DELETE
   reconcile is pending** (Phase 1, F4).
6. **Navigation model** → Home / Chats / Communities / You (mobile bottom nav,
   desktop left rail) with World pinned. **Pending (Phase 0.3).**
7. **Onboarding state machine** reduced to identity → privacy defaults → World,
   keeping trusted-state guards. **Pending (Phase 2, F2).**
8. **Documentation folders created** (`docs/security`, `docs/privacy`,
   `docs/research`) before feature PRs reference them. **Pending (Phase 0.3 partial / F11).**
9. **Tooling installed** (Supabase CLI) so DB-diff/reset and policy verification
   are reproducible (operator action). **Pending (operator).**

## 10. Phase roadmap

Phases execute in order; a prior security-critical phase must be green before the
next starts. Each phase ends with the gate (§12) + a Phase report
(directive §58).

- **Phase 0.1 (baseline stabilization):** ✅ DONE — red gate fixed (chain test),
  baseline recorded, bundle hashes logged.
- **Phase 0.2 (migration hardening):** ✅ DONE — `160001`–`160005` reworked as
  one coherent batch (requests/blocks/privacy RL+RLS+lifecycle RPCs); universal
  RLS test + 11 request/block/privacy regression tests added; gate green
  (209/209). Remaining: hosted push (owner confirmation) + fresh-reset World-only
  verification.
- **Phase 0.3 (architecture refactor):** navigation → Home/Chats/Communities/You;
  frontend switch to `resolve_sender_names` for World sender labels (must precede
  any DB push); thread gating hooks (DB side already done).
- **Phase 1 (World):** F3 messaging completeness (edit/delete/reply/copy) + F4
  realtime (INSERT/UPDATE/DELETE, cleanup) + F1 hardening + F10 rate limits.
- **Phase 2 (identity/onboarding):** F2 two-step onboarding + F7 privacy flags +
  F8 You shell.
- **Phase 3 (private layer):** F5 requests + F6 blocking end-to-end (RPC + UI +
  adversarial tests + manual 2-user matrix).
- **Phase 4 (privacy/security surface):** F9 deletion docs/stub + settings that
  prove real effect + docs program (§11).
- **Phase 5 (hardening/release):** complete E2E + adversarial suite, mobile/
  desktop/accessibility, deploy + live smoke + bundle-hash evidence, release
  checklist binary pass.

## 11. Documentation program (created alongside features)

- `docs/security/{SECURITY-MODEL,THREAT-MODEL,AUTHORIZATION,E2EE-STATUS,RECOVERY-MODEL}.md`
- `docs/privacy/{DATA-INVENTORY,RETENTION,USER-CONTROLS,OPERATOR-VISIBILITY}.md`
- `docs/research/{identity,messaging,community,moderation,themes,recovery,realtime,mobile-ux,accessibility,storage,e2ee,abuse}.md`
- Update in lockstep: `CURRENT-ARCHITECTURE.md`, `ENVIRONMENTS.md`,
  `V1-RELEASE-CHECKLIST.md`, `V1-TEST-PLAN.md`, `README.md`.
- Honest-language rule: no "E2EE", "anonymous", "untraceable", or "verified"
  claims without implemented, tested backing; recovery stays labeled placeholder.

## 12. Verification contract (test gate)

The gate for any merge/a-deploy:

1. `npm run typecheck` clean
2. `npm run lint` clean
3. `npm test` green (currently **RED** — Phase 0.1 first)
4. `npm run build` clean, bundle hashes recorded
5. `npm run smoke` pass (headless Chrome)
6. Live sanity probe (publishable key, read-only): expected tables exist/absent
   as documented; no unexpected new endpoints
7. For any DB change: universal RLS test green; diff review; hosted push only
   after linked-project confirmation
8. Manual items in `V1-TEST-PLAN.md` recorded or explicitly `UNVERIFIED` — never
   presented as verified

Tooling note: with no local Supabase CLI/Docker, item 6 uses the publishable-key
REST probe; `supabase db reset` local verification is ON HOLD pending operator
install. Nothing that depends on a live-DB assertion may be marked verified
until the probe or an owner-approved hosted path executes it.

## 13. Hard-stop conditions (current environment)

Execution halts and the owner/operator is consulted on any of:

1. Pushing **any** migration to hosted V1 without confirming the linked project
   (`afkxawjhaoobdnegaekp`) — the archive project is unconditionally forbidden.
2. Any destructive DB action (reset, delete-account execution, mass deletes)
   against hosted without written owner confirmation — retention confirmed first.
3. Ambiguous target environment (no clear LOCAL/V1/OLD determination).
4. Any cryptographic primitive/protocol decision for data at rest beyond the
   TLS-only baseline, or any E2EE wording change in shipped copy.
5. Any identity-architecture change (username/mail transport, anon pseudo-email
   semantics) without a written decision record.
6. Weakening RLS or removing a guard/trigger to make a feature work.
7. New analytics/fingerprinting/tracking surface, or offloading secrets to the
   client / introducing a service-role path into the bundle.
8. Using a reference project's code/logos without a license that permits it.
9. Third-party service receiving OFF user data.

## 14. Success definition (unchanged from the directive)

A V1 release is green only when: coherent architecture; reliable behavior;
strong RLS-authoritative authorization; honest privacy copy with real effects;
excellent UX on mobile + desktop; maintainable code; tested failure modes;
explicit limitations; reproducible deployment; and a passing binary gate (this
plan §12 + `V1-RELEASE-CHECKLIST.md`). E2EE is not claimed until implemented and
verified; recovery remains an honest placeholder; World/communities are
server-readable by design.

*— End of V1-MASTER-IMPLEMENTATION-PLAN.md (rev 2026-09-16).*