# OFF — V1-RELEASE-CHECKLIST.md

Gate for the privacy-first V1. Every item is binary; nothing may be marked done on intent.

## Code + automation gate
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (V1 suite, incl. no-Google surface checks)
- [ ] `npm run build` succeeds and no unexpected asset changes
- [ ] `npm run smoke` passes in headless Chrome
- [ ] No service-role/secret strings committed; `.env*.local` not modified
- [ ] No E2EE claim anywhere in UI copy, README, or docs (roadmap-only language)

## Product surface
- [ ] Google OAuth fully removed (service, UI, config surface, tests, docs) — no `google` / `signInWithOAuth` / `oauth` remnants
- [ ] Sign-in/identity copy states exactly what OFF stores and does not store
- [ ] Onboarding is: create identity → privacy options → enter World (no country/interests questionnaire gate)
- [ ] World is the only room in the reset database (single public conversation)
- [ ] Privacy settings screen only contains toggles that change real behavior (V1) or explicit "off" defaults (V1.1)
- [ ] Block, delete-account, request-accept/reject behaviours are server-enforced (V1.1 deletions via RPC; V1 blocks via table+RLS)
- [ ] Mobile nav = Home/Chats/Communities/You (bottom nav); desktop uses the three-column hierarchy
- [ ] Accessibility: 44px touch targets, one h1 per view, aria-live labels, labels not placeholder-only, focus-visible

## Honesty documentation
- [ ] `docs/*` (10 files) exist and match the code this release actually ships
- [ ] Every "manual" test in V1-TEST-PLAN has a recorded result or an explicit UNVERIFIED marker
- [ ] No term "private" implies E2EE; transport-only language used where true

## Database
- [ ] Reset artifacts (`scripts/reset-to-world.sql`, `supabase/seed.sql`) are idempotent and reviewed
- [ ] Reset has NOT been executed against the ambiguous hosted project without written human confirmation
- [ ] Local `supabase db reset` + seed yields World-only DB

## Release exit criteria
- [ ] All gate items above pass; any failing item blocks the release
- [ ] Operator has confirmed environment classification before touching a live DB
- [ ] Changelog/README updated with the pivot; version bumped; commit made ONLY on explicit request