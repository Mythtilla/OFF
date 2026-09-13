# OFF — E2EE-ROADMAP.md

Honest layering: OFF currently has transport encryption only. Nothing in this document is implemented code; it is a roadmap with architectural consequences.

## Today (V1 baseline)

| Layer | Status | Notes |
|---|---|---|
| Transport encryption | TLS everywhere (browser↔Worker↔Supabase, realtime websockets) | standard |
| Server-side storage | plaintext message bodies in Postgres | RLS restricts access by users, not by OFF infra |
| End-to-end encryption | **not implemented** | OFF does not claim E2EE |
| Local database encryption | none (no local DB) | browser caches are platform-managed |
| Metadata protection | partial | no typing/read-receipts/analytics; DMs gated by RLS |

## What must change before OFF can honestly claim E2EE

1. **Key management per user.** Each account needs a persistent keypair (or session pair) whose private key never leaves the client.
   - Consequence: a new device cannot decrypt history → key backup/recovery must be designed BEFORE rollout, and OFF must decide whether recovering keys is possible (supersedes the current placeholder recovery ceremony).
2. **Message model change.** `messages` body column must store ciphertext + a recipients/keyset reference; the DB loses the ability to serve plaintext.
   - Realtime must push ciphertext, not plaintext rows.
   - Indexes/filtering on plaintext (search) become impossible or require a separate privacy trade.
3. **Identity binding.** Verification of the peer's key at first contact (a trust-on-first-use + short-code compare flow) becomes mandatory, else an active MITM defeats "E2EE on paper."
4. **Group/World problem.** E2EE in an open public room (World) is nonsensical (anybody must be able to read). E2EE applies to **private conversations**; World stays server-readable by nature. OFF must state this boundary precisely.
5. **Abuse controls degrade.** Server-side moderation (block, delete, scan-free plaintext search) is weakened by E2EE. Block/delete must operate on ciphertext/envelope or be explicitly scoped.

## Candidate library path (do not invent crypto)

- DMs: libsodium (`crypto_box` / `crypto_kx`) or the Signal Protocol via an established, audited library (e.g., `@privacyresearch/libsignal-protocol`), NaCl-style short codes for verification.
- Group/DM only; never hand-rolled.
- Ship with a published threat model and a test suite that asserts ciphertext blindness for the DB role.

## Milestones

| Milestone | Scope | Honest claim after |
|---|---|---|
| M0 (V1) | transport only | "messages are encrypted in transit; OFF infrastructure can read stored content" |
| M1 (V1.1 – V2) | E2EE DMs with libsodium/established protocol; trust-on-first-use + short-code verify; key recovery designed (seed/export), PBKDF2-wrapped exported keys | "private conversations are end-to-end encrypted; World and communities remain server-readable" |
| M2 (future) | e2ee world split (public = plaintext, private = ciphertext) audit, multi-device reconcile, disappearing messages integrated with E2EE | "senders cannot be un-done by server; server storage is ciphertext for private DMs" |

## The one sentence OFF is allowed to say today

**"OFF uses HTTPS transport encryption and RLS-access control; end-to-end encryption is a planned milestone, not a shipped feature."**

## Guardrails

- No homemade cryptographic primitives.
- No claiming E2EE based on TLS or on "the DB is private because RLS."
- Before any E2EE merge, the key-recovery answer must be written down; else users lose accounts and OFF ships a worse failure than today.