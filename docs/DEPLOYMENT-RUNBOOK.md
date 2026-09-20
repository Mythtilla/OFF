# OFF — DEPLOYMENT-RUNBOOK.md

Target: apply the audited migration chain to the hosted Supabase project (`afkxawjhaoobdnegaekp.supabase.co`) reconciling any historical drift, without breaking live traffic.

Who: a person with Supabase dashboard access (project owner). No OFF credential grants agent/IaC access today.

## 1. Policy (read first)

1. **Apply in order.** The 25-file chain is sequential and policies are reset/refined by later files. Skipping order recreates the exact class of drift this runbook exists to fix.
2. **Stop on first error.** Run each file as one SQL script in the project's SQL Editor. If it fails, stop; do not move to the next file. A partial file must be cleaned up before re-running.
3. **One promotion patch, fresh apply.** For the hosted DB, the 8 files listed in §2 compose a single promotion patch. Their intra-repo ordering is dependency-safe (160005 rebuilds RPCs on top of 160001/160002; 170002 depends on 160006's flow). Apply them in the listed order even if the hosted DB appears current.
4. **Do not hand-edit SQL.** Drift comes from hand-patching. The authoritative copy is `supabase/migrations/`.

## 2. Promotion patch (hosted DB only)

The hosted DB already ran the 2026-06/07 era files (baseline through `202609070001_username_status.sql`) and has the `160006` slim-fit and privacy-flag policies live via an earlier dash-patch. The following **must still be verified/re-applied in order**:

| # | File | Why |
|---|---|---|
| 1 | `supabase/migrations/202609160001_dm_requests.sql` | `dm_requests` table + thread/request state |
| 2 | `supabase/migrations/202609160002_blocks.sql` | `blocks` table (server-enforced blocking) |
| 3 | `supabase/migrations/202609160003_privacy_flags.sql` | privacy-flag columns on profiles; idempotent re-run is safe |
| 4 | `supabase/migrations/202609160004_rls_privacy_policies.sql` | **authoritative RLS reset** — narrows `profiles_read`, profile self-reads, public-room readability |
| 5 | `supabase/migrations/202609160005_requests_blocks_rpc.sql` | request/block lifecycle RPCs — **includes the re-send/reopen `send_dm_request` fix** |
| 6 | `supabase/migrations/202609160006_onboarding_slim.sql` | two-step ceremony + World membership; idempotent re-run is safe |
| 7 | `supabase/migrations/202609170001_rate_limits.sql` | DB-level `username_status` rate limiting |
| 8 | `supabase/migrations/202609170002_recovery.sql` | real recovery (verifier + `recover_account` + session revoke) |
| 9 | `supabase/migrations/202609170003_avatar_scheme_guard.sql` | avatar URL scheme CHECK |

If any of 4–9 already exist in the hosted DB (from the dash-patch), re-running is idempotent because the files are `create or replace` / `alter … if not exists` style — but **verify via the probes in §3 before assuming** so, and flag any diff.

## 3. Post-apply verification probes

Run these against the hosted DB with a project-owner SQL Editor session after each file, then again at the end.

### RLS posture (after #4)

```sql
-- Confirm known policies are absent/present as expected (sample, not exhaustive)
select proname from pg_proc where proname in
 ('resolve_sender_names','send_dm_request','accept_dm_request','reject_dm_request',
  'block_user','unblock_user','is_blocked','can_access_thread','username_status',
  'set_recovery_verifier','recover_account')
order by proname;
-- Expect all rows present after #2/#8.
```

### Grantee exposure (after #5, #7, #8)

```sql
select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('resolve_sender_names','send_dm_request','accept_dm_request',
    'reject_dm_request','block_user','unblock_user','can_access_thread','get_or_create_dm_thread');
-- Expect all true. username_status additionally granted to anon;
-- recover_account additionally granted to anon.
```

### Reopen semantics (after #5) — requires an authenticated session (e.g., two test users)

```sql
-- User A has an existing 'rejected' request to B (from reject_dm_request):
select send_dm_request('<b-id>');                                  -- expect 0 (or pending)
select status from dm_requests where sender_id = '<a-id>';
-- Expect 'pending' again — the ON CONFLICT reopen fix, NOT a silent no-op.
select send_dm_request('<already-accepted-b-id>');                 -- must NOT re-accept
-- Expect the accepted row still 'accepted'.
```

### Rate limiting (after #7) — anon session

```sql
-- Hammer username_status with the same plausible header; expect 'rate_limited'.
select username_status('rate_limit_probe_test');
```

### Recovery (after #8)

```sql
-- Auth'd user with a phrase: binding must succeed.
select set_recovery_verifier('<bcrypt-verifier-string>');          -- expect OK
select recovery_hash, length(recovery_hash) > 0 as populated from recovery_verifiers;
-- Anonymous recovery attempt with wrong phrase must fail cleanly:
select recover_account('wrong-phrase', 'newpass123', '<email>');   -- expect error / no row
-- After successful recover_account: confirm the account session count drops to 0.
select count(*) from auth.sessions where user_id = '<uid>';        -- expect 0
```

### Avatar scheme guard (after #9)

```sql
-- Expect failure:
insert into profiles (id, username, avatar_url) values ('<uid>', 'probe', 'http://evil.test/x.png');
-- Expect success:
insert into profiles (id, username, avatar_url) values ('<uid>', 'probe2', 'https://avatars.githubusercontent.com/u/1?v=4');
```

## 4. Client smoke test

1. `npm run build` (verified clean in repo).
2. Deploy `dist/` to Workers Static Assets.
3. Sign up a fresh account; confirm two-step onboarding (recovery phrase → profile), then land in World.
4. Confirm `resolve_sender_names` labels a World partner's message as their username (RPC-first path).
5. In another (incognito) account: `send_dm_request` → accept → both see the thread; reject → re-send from the requester → the request returns to `pending`.
6. Visit the production URL: assert only the CSP `script-src 'self'` policy (no inline scripts) via `curl -sI` head check of `Content-Security-Policy` header on `https://off.testingver.workers.dev/`.

   > **Current live state (checked 2026-09-18): this step FAILS today.** The deployed site still serves the stale `'sha256-PJo99COB3rYJDHyVpZibR5SnffklVtnhFzFtvika894='` in `script-src` because the deployment predates the Part H fix. Re-deploying `dist/` from the current build removes the stale hash; re-run the head check and confirm `script-src 'self'` with no hash before signing off.

## 5. Rollback

- Every file in the promotion patch is additive and policy-restating; rollback consists of re-running `202609060005_authoritative_rls.sql` (pre-narrowing posture) — **do not** claim parity with this repo if rolling back. If a probe in §3 fails, STOP, do not open traffic, and report the probe output verbatim.