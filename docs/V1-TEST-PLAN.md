# OFF — V1-TEST-PLAN.md

Coverage matrix for the OFF V1 pivot. "Automated" = Vitest/static tests in this repo. "Manual" = must run against live Supabase + browser (honestly optional until the environment is approved).

Actors: anonymous, user A, user B, blocked user, room owner, room member, unauthorized user.

## Automated (in-repo, no browser service)

| Area | Tests | Evidence file |
|---|---|---|
| Auth | username canonicalize/validate, availability RPC states + failure→idle, password strength boundaries, safe error mapping | `auth-experience.test.ts`, `foundation.test.ts` |
| Identity | no Google path in code/config surface; derived-email doc consistency; env guard | `security-audit.test.ts`, `platform-static.test.ts` |
| Onboarding | step routing, progress % (incl. 50/75), interests legality | `foundation.test.ts`, `resilience.test.ts` |
| Messaging | reconcile idempotency (client id + server id), append-only order, grouping, sender precedence, pending flags | `chat-logic.test.ts`, `resilience.test.ts` |
| Rooms/RLS (static) | no service-role client path; policies present; no weakened policies | `security-audit.test.ts` |
| CSS/UX | tokens centralized, 44px touch targets, breakpoints, reduced-motion, focus-visible | `ui-smoke.test.tsx` |
| A11y (SSR) | one h1 per view, aria-live, aria-selected, labels, icon-button names | `ui-smoke.test.tsx` |
| Config/deploy | `_headers` CSP/HSTS/XFO/Permissions-Policy, index.html metadata, no external scripts | `platform-static.test.ts` |
| Smoke (real render) | production build boots in headless Chrome, no uncaught errors, assets serve | `scripts/smoke.mjs` |

## Manual — required before any V1 release (documented, not faked)

| Area | Procedure (against approved env) |
|---|---|
| World | A and B read/post World; realtime reflects both; edit/delete only by author |
| Private conversation | B sends DM → A receives as Request; accept → thread; reject → no thread; block → B cannot re-request |
| Blocking (API-level) | B's direct RPC to create thread with A fails after block; realtime subscription yields nothing |
| RLS | B cannot SELECT A's private room messages; owner triggers still hold; no privilege escalation via direct SQL client |
| Account deletion | A deletes account → profile/memberships/messages removed; B's cached/forwarded copies remain (asserted in copy) |
| Rate limits | repeated username_status / create_room / invite hits are limited; no separate tracking introduced |
| Mobile | bottom-nav flows at 320/375/420px; 44px targets; safe-area composer |
| Desktop | three-column hierarchy, keyboard nav, focus states |
| Disappearing (V1.1) | timers on send/read; server does not delete what it cannot see; copy/screenshot retainer acknowledged |
| E2EE (future) | ciphertext-at-rest asserted for DMs; plaintext World retained |

## Gate

A V1 merge is green only when: `npm run typecheck`, `npm run lint`, `npm test` (all pass), `npm run build`, `npm run smoke` (headless), and every "Manual — required" item above has a recorded result or an explicit unverified marker. Nothing marked unverified may be presented as verified.