# OFF — FIX-VERIFICATION.md

Checklist capturing the security-accuracy remediation sweep (2026-09-18). Each item carries one label: **PASS** (verified in-repo), **FIXED** (changed this session, verified by test), **PENDING-MANUAL** (requires a credential OFF does not have), **NOT APPLICABLE**.

## A. Repository reconciliation

| Item | Check | Label | Evidence |
|---|---|---|---|
| A1 | `git status` clean of stray untracked files outside the intended additions | PASS | untracked = tests + migrations `170001–003` only |
| A2 | Working tree matches the audited migration chain (no partially applied state in-repo) | PASS | all 25 migration files present, sequential |
| A3 | No secrets/credentials committed (only anon/publishable key pattern) | PASS | config + code audit; no service role |

## B. Migration corpus audit

| Item | Check | Label | Evidence |
|---|---|---|---|
| B1 | All 25 migration files read end-to-end, chain is complete and sequential | PASS | 060001→015, 070001, 160001→006, 170001→003 |
| B2 | Authoritative versions are the strictest (RLS reset 160004, thread guard 160005, onboarding 160006, username_status 170001) | PASS | cross-file diff vs earlier duplicates |
| B3 | `send_dm_request` ON CONFLICT must re-send a rejected request (reopen), never silently no-op, never re-accept | PASS | regression test in `src/test/security-audit.test.ts` |

## C. Frontend fit vs. narrowed RLS

| Item | Check | Label | Evidence |
|---|---|---|---|
| C1 | Sender labels resolved RPC-first (`resolve_sender_names`), fallback self-or-`discoverable` profile read | PASS | `ChatShell.tsx` |
| C2 | `ProfileSettings` / `main.tsx` profile reads are self-scoped (compatible with the `profiles_read` narrowing) | PASS | read of `profiles` joins only user's own row |
| C3 | No client path relies on the removed `isDiscoverable` behavior | PASS | `rooms/permissions.ts` audit |

## E. Deployed-state verification

| Item | Check | Label | Evidence |
|---|---|---|---|
| E1 | Hosted DB currently matches the full 25-file chain | **PENDING-MANUAL — probed OUT OF SYNC** | live RPC probes (see §R): `set_recovery_verifier`, `recover_account`, `send_dm_request`, `block_user`, `unblock_user`, `resolve_sender_names`, `dm_requests` all 404 on hosted |
| E2 | Hosted config matches `202609160003` privacy flags | PENDING-MANUAL | no DB/CLI credentials |

## F. SQL lint / formatting pass

| Item | Check | Label | Evidence |
|---|---|---|---|
| F1 | Promotion-patch files lint clean (syntax) | PASS | no SQL linter configured; manual review + grep pass for unbalanced begin/commit, missing grants |

## G. Inline style / HtmlWebpackPlugin audit

| Item | Check | Label | Evidence |
|---|---|---|---|
| G1 | No remaining inline `style=…` on dynamic elements (must be CSS instead) | PASS | grep audit |
| G2 | Built `dist/index.html` contains zero inline scripts | PASS | read of build output |

## H. Content Security Policy

| Item | Check | Label | Evidence |
|---|---|---|---|
| H1 | `script-src` is `'self'` only — no stale `sha256-…` token, no `unsafe-inline` | FIXED | stale hash removed from `public/_headers`; regression test |
| H2 | Bidirectional hash invariant: every pinned `sha256-` matches an inline script in the built page and vice versa (falls back to source `index.html` when `dist/` absent) | FIXED | regression test in `src/test/security-audit.test.ts` |
| H3 | `style-src 'unsafe-inline'` held (React inline styles) — asserted only on `script-src` | PASS | corrected test |

## I. E2EE claims and design

| Item | Check | Label | Evidence |
|---|---|---|---|
| I1 | OFF makes no shipped-E2EE claim; README/docs say transport-only | FIXED | `docs/E2EE-DESIGN.md` + README corrected |
| I2 | E2EE design doc exists: threat model, recovery decision, World boundary, library path, no homemade crypto | FIXED | `docs/E2EE-DESIGN.md` |

## J. Recovery mechanism accuracy

| Item | Check | Label | Evidence |
|---|---|---|---|
| J1 | Recovery described as real — bcrypt verifier over SHA-256 digests (`recovery_hash`), password reset + session revoke | PASS | migration `170002` + `auth/recovery.ts` + tests |
| J2 | Recovery never described as a key backup | FIXED | README, `docs/V1-FEATURE-SPEC.md`, `docs/IDENTITY-DESIGN.md`, `docs/E2EE-DESIGN.md` |

## K. Principle of least astonishment

| Item | Check | Label | Evidence |
|---|---|---|---|
| K1 | User-facing copy matches shipped behavior (no "Private conversations" overclaim, no "recovery placeholder", no "4-step onboarding") | FIXED | `src/main.tsx`, `index.html`, README, 4 docs |
| K2 | Test suite baseline maintained: 234 pre-existing + 3 new regression tests (237 green) | PASS | full suite green (see Q) |

## M. Product copy

| Item | Check | Label | Evidence |
|---|---|---|---|
| M1 | Landing eyebrow: "PSEUDONYM-FIRST · OPEN COMMUNITIES" | FIXED | `src/main.tsx:35` |
| M2 | `index.html` meta + og:description claw back the "Private conversations" claim | FIXED | `index.html:8,16` |

## O. Deployment runbook

| Item | Check | Label | Evidence |
|---|---|---|---|
| O1 | Manual promotion order + per-step verification probes documented for anyone with credentials | FIXED | `docs/DEPLOYMENT-RUNBOOK.md` |
| O2 | Runbook captures intra-repo ordering so files can be one promotion patch | FIXED | runbook §2 |

## Q. Final gate

| Item | Check | Label | Evidence |
|---|---|---|---|
| Q1 | Full Vitest suite green (237 tests, incl. new CSP + re-send + continuity regressions) | PASS | single-fork run |
| Q2 | `npm run typecheck` clean | PASS | `tsc --noEmit` |
| Q3 | `npm run lint` clean | PASS | eslint |
| Q4 | `npm run build` succeeds; built bundle carries new copy, zero "Private conversations"; dist has zero inline scripts | PASS | vite build |
| Q5·alt | `npm run smoke` headless run against the production build | PASS | scripts/smoke.mjs — all probes green |
| Q5 | **Migration application on the hosted DB** | **PENDING-MANUAL** | no credentials — see runbook |
| Q6 | **Live-site CSP header matches this repo** — currently `off.testingver.workers.dev` still serves the stale `'sha256-PJo99COB3rYJDHyVpZibR5SnffklVtnhFzFtvika894='` in `script-src` (deployment predates the Part H fix) | **PENDING-DEPLOY** | re-deploy `dist/` (current build) to Workers; re-run `curl -sI` and expect `script-src 'self'` with no hash |

## R. Browser QA (dual viewport, live backend) — 2026-09-19

Runtime verification of the *current repo build* against the hosted Supabase backend, with two fresh accounts
created through the real UI (desktop 1440×900 and mobile 390×844, Firefox headless). Full report with
screenshots: `docs/qa/BROWSER-QA-REPORT.md`.

| Item | Check | Label | Evidence |
|---|---|---|---|
| R1 | Whole-deselect signup path (`signup.scrappy` option) ends in the same onboarding outcome as the normal path | PASS | identical flow exercised; both reach recovery → profile → chat (via assist) |
| R2 | Two-account end-to-end chat works over the *hosted* backend (not a stub) | PASS | `create_room`, realtime A→B and B→A, reply, presence "● Live" |
| R3 | New-user onboarding recovery ceremony completes on hosted | **FAIL — PENDING-MANUAL** | Continue → `rpc/set_recovery_verifier` 404 → "Something went wrong." (4× reproduced); see §3.1 of QA report |
| R4 | DM threading works: thread created, DM inserted, counterparty reads it | PASS | `get_or_create_dm_thread` 200; insert 201; cross-account read 200 |
| R5 | Block/unblock intended to gate `can_access_thread` | PENDING-MANUAL | `block_user`/`unblock_user` 404 on hosted → `can_access_thread` remains `true` |
| R6 | Profile save persists on desktop and mobile | PASS | bio readback "probe bio edited NOW" (desktop) / "edited at 390px" (mobile); editor closes |
| R7 | Settings success confirmation visible to the user | FAIL (product) | `setStatus("Saved.")` + `setEditing(false)` in one batch → status unmounts before paint (§4.3 QA report) |
| R8 | Screenshots collected for the QA record | PASS | `docs/qa/shots/` (18 PNGs) |

## Critical note

A spread of **PENDING-MANUAL** items remains on the live database, and browser QA (Part R) has now confirmed
the user-visible consequence: **new accounts cannot finish onboarding on the hosted backend** — the recovery
ceremony calls `rpc/set_recovery_verifier`, which is not deployed (404), so the UI stalls with "Something went
wrong. Please try again." Do not open traffic to a hosted DB whose policies predate
`202609160004_rls_privacy_policies.sql`. Until the 8-file promotion patch (see `docs/DEPLOYMENT-RUNBOOK.md`) is
applied by someone with DB access, the hosted instance does not match the audited postures in this repository,
and onboarding/recovery/DM-requests/block are degraded or broken for real users.