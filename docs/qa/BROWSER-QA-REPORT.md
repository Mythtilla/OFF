# OFF — Browser QA + Backend Drift Report

Run stamp `072566` · repo-built bundle `dist/index-DzovZFwu.js` (local preview, port 4173)
Live Workers site compared separately: `https://off.testingver.workers.dev/` (`index-DTyOoK_u.js`)

Method: Playwright (Firefox headless), two concurrent sessions — A = desktop 1440×900, B = mobile
390×844 (touch, DPR 2). Two fresh accounts created through the real UI. 64 probes, 12 console entries,
17 screenshots (canonical dir: `~/off-qa/shots/`, and in `docs/qa/`).

---

## 1. Pass matrix (verified green)

| Area | Probe | Result |
|---|---|---|
| Landing | `landing:loads` (desktop + mobile) | PASS — copy "PSEUDONYM-FIRST · OPEN COMMUNITIES / Talk freely. / Stay deliberate."; returning users get a "Sign in" entry |
| Auth | `username:available` | PASS — live availability: `qa_alice_* is available` |
| Auth | `username:taken` | PASS — `is taken` after first signup |
| Auth | `strength:short` | PASS — inline "Strength: Too short" hint |
| Onboarding | recovery phrase render | PASS — 24 words rendered |
| Onboarding | Continue gating | PASS — primary disabled until "I have securely stored my recovery phrase." checked |
| Onboarding | recovery ceremony completion | **FAIL (environmental)** — see §3.1 |
| Onboarding | profile step save | PASS (after API assist) — both accounts reached chat shell |
| Presence | `presence:A/B after onboarding` | PASS — "● Live" indicator |
| Chat | `chat:A->B realtime` | PASS — B (mobile) sees A's message live, no reload |
| Chat | `chat:B->A realtime` | PASS — A (desktop) sees B's message live |
| Chat | message menu, other users | PASS — other user's bubble offers Reply, Copy only (no Edit/Delete) |
| Chat | reply | PASS — "Replying to" composer, reply delivered with quoted body |
| Chat | own-message Edit/Delete | FLAKY — passed on earlier run (stamp `339559`), not reproduced stamp `072566`; gating logic correct (`own && !pending`), see §4.2 |
| Rooms | desktop nav list | PASS — joined room listed |
| Rooms | search no-match | PASS — list empties on unmatched filter |
| Rooms | mobile "Communities" sheet | PASS — sheet opens, room listed |
| Settings | mobile edit profile | PASS — bio persisted ("edited at 390px"), editor closed after Save |
| Settings | desktop edit profile | **PASS (follow-up probe)** — initial run FAILed on a harness strict-mode artifact (two `.profile-settings` in DOM), see §4.1. Probe: `view-mode-note:"probe bio edited NOW", edit-btn-present:1`, panel stays open |
| Auth | sign out / sign in | PASS — sign out → landing; re-login restores session |
| Session | session restore (B) | PASS |
| Backend | `create_room.private` / `.public` | PASS — 200, returns uuid |
| Backend | `join_public_room` | PASS — 204 |
| Backend | room message insert (custom room) | PASS — 201, row with room/thread ids |
| Backend | `join_private_room` (unauthorized) | PASS-as-denial — 400 `Room is not joinable` (correct refusal) |
| Backend | `get_or_create_dm_thread` | PASS — 200, thread uuid |
| Backend | DM insert | PASS — 201, `room_id:null, thread_id:<uuid>` |
| Backend | DM read cross-account | PASS — B reads A's DM in that thread (`can_access_thread` holds) |
| Backend | `can_access_thread` after block | PASS (informational) — still `true`; expected since `block_user` isn't deployed |
| Backend | `username_status` | PASS — 200 with suggestions `[qa_rate_0725662, …]` |

Tally: 22 PASS, 6 FAIL (classification in §3), 12 WARN (drift table), 24 INFO.

---

## 2. Evidence

`~/off-qa/shots/`: landing desktop/mobile, auth form desktop/mobile, world desktop/mobile, realtime both
directions, message actions, communities sheet, settings desktop (before + after save), "you" sheet mobile,
both recovery screens. Raw probe feed: `~/off-qa/results.json`, `~/off-qa/run-out.log`.

---

## 3. Failures and their real classification

### 3.1 CRITICAL — New accounts cannot finish onboarding on the hosted backend

`onboarding:recovery-blocked` (both viewports). After the user ticks "I have securely stored…" and clicks
Continue, RecoveryCeremony POSTs `rpc/set_recovery_verifier` → **404 PGRST202**; that function is not on the
hosted database. UI shows the generic "Something went wrong. Please try again." Reproduced 4× (two full-run
signups + two probe signups). The recovery UI itself is fine (24 words, checkbox gating); the RPC behind it
is missing. Workaround used to unblock the rest of QA: out-of-band completion with the browser's own token —
`acknowledge_recovery` 204 → `complete_profile` 204 → `complete_onboarding` 200 `true` → reload.

Also console-visible: `rpc/recover_account` → 404, so the password/account recovery path is unsupported on
hosted as well.

**Gate: PENDING-MANUAL — promote pending DB migrations (§6).** Live-user blocker: anyone signing up on the
deployed app right now is stopped at recovery.

### 3.2 Backend RPC/table availability — deployed DB is behind the repo

Probed live with a real signed-in token (feed in `~/off-qa/results.json`):

| Repo function / table | Hosted backend | Impact while missing |
|---|---|---|
| `set_recovery_verifier` (170002…) | **404** | Onboarding recovery ceremony broken (§3.1) |
| `recover_account` | **404** | Account recovery/reset unavailable |
| `send_dm_request` | **404** | DM requests unsendable (thread + direct insert still work) |
| `accept_dm_request` | not probed | likely missing (no `dm_requests` table) |
| `block_user` / `unblock_user` | **404** | Block does not apply; `can_access_thread` stays enumerable |
| `resolve_sender_names` | **404** | App calls it at runtime; console shows 404s; sender-name path degrades silently |
| `dm_requests` table | **404 PGRST205** ("Perhaps you meant the table public.dm_threads") | whole request/accept lifecycle absent |

Working on hosted: `acknowledge_recovery`, `complete_profile` (slim signature), `complete_onboarding`,
`create_room`, `join_public_room`, `get_or_create_dm_thread`, `can_access_thread`, `messages` insert/select
with RLS, `profiles` RLS, `join_private_room` denial, `username_status`.

### 3.3 Deployed Workers site stale vs repo

Live `index-DTyOoK_u.js` ≠ built `index-DzovZFwu.js`; live landing copy/meta/eyebrow and CSP are pre-fix.
**Gate: PENDING-DEPLOY — redeploy current `dist/`** (with §6 migrations first so the app and DB agree).

### 3.4 Harness-artifact false alarms (not app bugs)

- Desktop "Save did not close the editor" → Playwright strict-mode duplicate: the always-mounted mobile "You"
  sheet also renders a `.profile-settings`, unscoped selectors matched 2. Scoped probe proves save works (§1).
  The genuine UX issue underneath is the invisible confirmation (§4.3).
- `join_private_room.denied` = 400 → actually correct denial.
- `can_access_thread.after_block` = `true` → correct, since block isn't deployed.

---

## 4. UI/UX findings

### 4.1 Two ProfileSettings forms in one DOM
The desktop aside and the mobile "You" sheet both mount a full profile form; the hidden one is `display:none`
but stays in the DOM. Not a visual bug, but a fixture for automation and an a11y risk (duplicate labels,
duplicate "Edit profile" buttons). Consider mounting the mobile sheet only under the mobile breakpoint.

### 4.2 Own-message Edit/Delete intermittently absent (flaky)
`src/components/chat/ChatShell.tsx:855` gates Edit/Delete on `own && !message.pending`; `pending` flips off
after the insert resolves via `reconcileMessage` (ChatShell.tsx:321). Verified working on one run, failed on
the next inside the reply→edit sequence. Worth a manual click-through; if reproducible, inspect `pending`
sticking `true` when the insert `.select` races a realtime delivery of the same row.

### 4.3 "Saved." confirmation is never visible
`ProfileSettings.tsx:94-95` calls `setEditing(false)` and `setStatus("Saved.")` in the same React batch, so
the status `<p role="status">` unmounts before paint. The UI gives no success signal on profile save (the view
reloads with the user's eyes on the old bio). Fix: render the status in view mode too (a `justSaved` flag), or
move the confirmation into the view-mode `.note`.

### 4.4 Rooms: no "create room" affordance in the shipped UI
No create-room button on desktop nav or the mobile sheet (polled). Creation works server-side and an
API-created room joins fine — backend-complete, no UI surface.

### 4.5 Realtime websocket console noise (minor)
Every page emits `Cookie "__cf_bm" has been rejected for invalid domain.` from the Supabase/Cloudflare
realtime websocket in Firefox. Harmless (realtime works), but spams the console.

### 4.6 Generic error copy on recovery failure
The failure surfaces as "Something went wrong. Please try again." with no context on a state-loss-sensitive
path (recovery phrase). Recommend a distinguishable message plus server-side logging keyed to the failing RPC.

---

## 5. Environment notes

- Sessions ran against the repository preview build; the live site was captured separately and is stale (§3.3).
- Hosted Supabase project `afkxawjhaoobdnegaekp` (Cloudflare-proxied realtime). `.env.local` carries only
  publishable keys, so migrations can't be applied from this workspace (no service role). Manual gate.

---

## 6. Gates

1. **PENDING-MANUAL — hosted DB migration promotion.** With a service-role/owner client, apply pending
   migrations in order (order 160001 → … → 170003 in `supabase/migrations/`), then re-run the §3.2 probes
   until `set_recovery_verifier`, `recover_account`, `send_dm_request`, `accept_dm_request`, `block_user`,
   `unblock_user`, `resolve_sender_names` and `dm_requests` all resolve. Steps and SQL: `docs/DEPLOYMENT-RUNBOOK.md §2`, probes §3.
2. **PENDING-DEPLOY — redeploy the current bundle.** Ship `dist/` (current `index-DzovZFwu.js`) to Workers
   after §6.1 so the live landing copy, CSP, and bundle match the repo.
3. **Recommended backlog** (no gate): §4.3 confirmation fix; §4.4 create-room UI; §4.2 manual re-check of
   Edit/Delete; §4.5 console-noise cleanup; §4.6 recovery error copy.

---

*Compiled from the detached QA run stamp `072566` plus a targeted settings probe (17:xx, stamp `probe`). QA
harness lives in `~/off-qa/` (`run.js`, `probe-settings.js`, `shots/`).*
