# OFF — DATA-OWNERSHIP.md

For every data category: who creates it, who stores it, who can read it, who can modify it, how long it exists, how it is deleted, whether it is encrypted. "OFF service" = Supabase project; "host" = Cloudflare + Supabase ops.

Legend: `S` = server (Supabase DB/auth), `C` = client/browser, `O` = owner (the user), `M` = moderators/owners`.

| Data | Created by | Stored in | Read by | Modified by | Lifespan | Deletion | Encrypted |
|---|---|---|---|---|---|---|---|
| Pseudonym | user | profiles (S) | user, other users (as sender label) | user via RPC | until account deletion | account deletion flow | no (needed for display) |
| Internal derived auth email | OFF (derived) | Supabase Auth (S) | OFF service, Supabase ops | never | until account deletion | account deletion | storage at rest by provider |
| Password hash | user | Supabase Auth (S) | provider only | user (password change) | until account deletion | account deletion | hashed (bcrypt-class) |
| Session/refresh tokens | user+service | client storage + provider | client, provider | user (sign out) | until expiry/logout | sign out | TLS only |
| Profile metadata (bio/avatar/display prefs) | user | profiles (S) | user, others per visibility | user via RPC | until deletion | account deletion | no |
| Privacy settings | user | client-side local storage (C) + optionally profile (S) | user only | user | until changed/cleared | clear local storage | no (settings not secret) |
| Room memberships | user (join/create) | room_members (S) | members, approvers | user leave / room owner | until leave/room deleted | leave / reset | no |
| Messages (room) | user | messages (S) + realtime | room members per RLS | author (edit/delete); owner (delete where policy) | until author/owner deletes | soft-delete (deleted_at) | TLS only (no E2EE in V1) |
| Messages (DM) | user | messages (S, thread-ref), thread in dm_threads | participants only per RLS | author only | until author/participant deletes | delete by author/participant (V1.1) | TLS only |
| Message client event id | user/client | messages (S, transient column) | participants | never | until message deleted | message deletion | no |
| Invite links (V1.1) | user | client generates; server may hold hash for rate limit | invited party only | user (revoke) | until revoked/used | revoke | no (link IS the token) |
| Read/edit/delete/typing indicators (V1.1) | user | realtime only, transient | sender+recipient | sender | moment | none (transient) | TLS only |
| Block list (V1.1) | user | server-side table (blocked_users) | user + enforcement (RLS/worker) | user only | until unblocked | unblock | no |
| Onboarding progress flags | user | profiles (S) | user | user via RPC (guarded) | until onboarding completes | reset with wipe | no |
| Country code | user | profiles (S) via RPC | user only; never auto-exposed online (see Part 17) | user via RPC | until changed/deleted | account deletion | no |

## Principles

1. **Ownership = the creating user.** RLS already enforces author-only writes for messages and self-only writes for profiles.
2. **Minimize structure, not just content.** OFF stores only what a feature needs; e.g., no phone, no address book, no fingerprint, no analytics events.
3. **Local-first only for things that are local by nature**: UI preferences, drafts, cached messages (read-only copy), privacy settings. Server-authoritative data (identity, membership, messages for delivery) stays server-side, RLS-enforced.
4. **Deletion is honest**: server-side data can be deleted; other people's copies (screenshots, forwarded copies, realtime-cached copies on their device) cannot.
5. **Encryption is a later milestone**: V1 = transport (TLS) + provider storage-at-rest; V1.1+ = client-side message encryption for DMs (see E2EE-ROADMAP.md). This table will be re-verified after E2EE lands.