# OFF — E2EE-DESIGN.md

Status: design document, current as of 2026-09-18. This file states what OFF ships today, what E2EE would entail, and the decisions OFF has already made. Nothing here describes shipped E2EE code — OFF has none.

## Honest positioning

- OFF is currently **transport-encrypted, access-controlled plaintext**: TLS end-to-end (browser → Worker → Supabase REST/Realtime), and Postgres RLS gates who can read message bodies.
- OFF does **not** claim end-to-end encryption, local encryption, key management, or ciphertext storage.
- The allowed one-sentence claim is:

  > "OFF uses HTTPS transport encryption and RLS access control; end-to-end encryption is a planned milestone, not a shipped feature."

## Threat model (current)

Protects against:

- Network observers / passive wiretaps between the browser, the static host, and Supabase (TLS).
- Unauthenticated or unauthorized users reading content (Supabase auth + RLS).
- Accidental leakage of content via public room membership rules (World/interest rooms are public-read by design; private rooms are member-only; DMs require an accepted request or an existing thread).

Does **not** protect against:

- The storage operator (Supabase / Postgres superuser, replication, backups) reading message bodies — this is inherent to plaintext storage.
- A malicious client / compromised device reading whatever that client can legitimately read.
- Metadata: who talks to whom, when, at what volume (TLS shows endpoints; realtime traffic reveals activity).

## The recovery decision (already made)

OFF ships a real, bounded recovery mechanism (`202609170002_recovery.sql`):

- The user is given a 24-word phrase during onboarding.
- The client stores a one-way **bcrypt verifier** of a SHA-256 digest of the phrase (`recovery_hash`), so a database leak alone neither reveals the phrase nor enables offline guessing at scale.
- `recover_account` requires the phrase plus the new password; it resets the password and **revokes all sessions**.
- This is **password recovery**, not a cryptographic key backup. It cannot recover E2EE keys, because OFF stores no keys today.

Consequence for the E2EE roadmap: when OFF adds real key management, key recovery must be designed as part of that milestone. The password-recovery ceremony must not be retrofitted into a "therefore the server can recover your keys" claim — the server holding a copy of any decryption key negates E2EE for that content, and OFF should say so explicitly.

## Boundary: E2EE applies to private conversations, not World

- The World room and public interest rooms are, by design, readable by everyone. Encrypting them would make them unusable; they stay server-readable plaintext under RLS.
- E2EE, when it lands, applies to **private conversations** (accepted DM threads and member-only custom rooms).
- OFF must state this boundary wherever it makes E2EE claims (mirror the M1 claim in `docs/E2EE-ROADMAP.md`).

## Prerequisites before any E2EE merge

1. **Key management.** A per-user keypair (or session pair) whose private key never leaves the client; multi-device meaning defined (per-device session keys vs. an encrypted master key synchronized via passphrase-PBKDF2, decided per milestone).
2. **Key recovery answer written down** and shipped in testable form — the exact flow for a user who loses one device. `recover_account` resets the password; it must never be presented as the key-recovery path.
3. **Message model change.** `messages.body` stores ciphertext plus a recipients/keyset reference; plaintext search and plaintext server-side scans over private content are removed or explicitly traded away.
4. **Identity binding.** Trust-on-first-use plus a short-code compare (NaCl-style) for peer key verification; otherwise an active MITM defeats "E2EE on paper." OFF's existing sender-resolution flow (`resolve_sender_names`) must be extended so sender identity is an authenticated public key, not just a derived email.
5. **Abuse-control impact assessed.** Block/delete/moderation must operate on ciphertext or envelope metadata (or be explicitly scoped to public content), and the server enforcing `block_user` must still be able to revoke membership even though it can no longer read the body.

## Library path (do not invent crypto)

- DMs: libsodium (`crypto_box` / `crypto_kx`) or the Signal Protocol via an established, audited library (e.g., `@privacyresearch/libsignal-protocol`).
- Group/private rooms: MLS if/when needed; otherwise the same per-recipient box. Never hand-rolled primitives, never bespoke key-derivation, never homegrown padding schemes.
- Every E2EE change ships with:
  - a published threat model (this file, versioned),
  - a test suite asserting **ciphertext blindness for the DB role** (a Postgres-only "attacker" cannot read bodies),
  - an upgrade/backfill plan for existing plaintext threads (opt-in vs. forced rekey).

## What is already in place that E2EE must not break

- RLS as the access-control layer (messages, threads, `can_access_thread`).
- Server-enforced blocking (task migration 160005) that revokes thread access.
- `rate_limited` on `username_status` (170001) — abuse controls stay in force regardless of content cryptography.
- The authoritative RLS reset (160004) and the narrowed profile-reader surface.

## Current gap summary

| Area | Today | E2EE milestone |
|---|---|---|
| Transport | TLS | unchanged |
| Content at rest | plaintext + RLS | ciphertext for private threads |
| Keys | none stored | per-user keypair; server never holds private keys |
| Recovery | password reset (real, non-key) | + designed key-recovery story |
| Identity binding | derived email + RLS | TOFU + short-code verify |
| Abuse control | server-side block/limit | operate on envelopes/scoped to public |
| Testing | static audits + unit tests | ciphertext-blindness test for DB role |