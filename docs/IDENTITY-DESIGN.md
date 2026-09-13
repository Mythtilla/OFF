# OFF — IDENTITY-DESIGN.md

## Why OFF needs a precise identity statement

The current app uses a username + password over Supabase Auth. Supabase Auth requires an email/phone identifier to create a sign-in identity, so OFF currently derives a deterministic, non-deliverable pseudo-email from the username. That is an **implementation detail, not a claim**. OFF must be precise about what it knows.

## Honest identity ladder

| Model | What the user gives | What the service knows | Recovery |
|---|---|---|---|
| SimpleX | nothing (device-generated) | nothing persistent beyond transient queues | no server recovery; manual encrypted DB backup |
| Session | nothing (device-generated key) | public key | seed phrase restores key |
| Briar | self-chosen nickname | public key (local) | none (device-bound) |
| Signal | phone number + optional PIN | phone number, account timestamps | phone + PIN; no message history |
| OFF (current) | pseudonym + password | derived pseudo-email, pseudonym, DB profile | password reset not implemented; ceremony is a placeholder |

## OFF V1 identity model

**Choose: OFF = pseudonymous account, not "anonymous account".**

A user creates an identity with exactly:

- a **pseudonym** (display identity, required, unique, chosen at signup — kept minimal: name only, no bio/avatar required),
- a **password** (the credential for the account),
- **privacy preference** (defaults, one screen).

That is the *minimum* required to operate a web community where the server must authenticate writers. OFF stores, and says it stores:

1. a pseudonym,
2. a derived internal auth email (never shown, never used for delivery),
3. a password hash (held by Supabase Auth, not OFF),
4. a profile row created automatically,
5. message/membership data the user chooses to create.

OFF does **not** collect: phone, real name, date of birth, location, email address (real), or marketing profile.

## What OFF explicitly does NOT claim

- OFF is **not** anonymous. A hosting operator (Supabase) can see accounts and content.
- OFF identities are **not** device-local; they are server-accounts. This is a deliberate trade for:
  - real multi-device usable sign-in,
  - server-side RLS-enforced writing,
  - a recoverable community where nobody hand-manages keys.
- Losing your password currently loses the account (recall/recovery is a placeholder). This limitation is disclosed.

## Verification of identity (V1.1+)

Identity between two users is verified **out of band**, not cryptographically guaranteed:
- each profile shows a **connection code** (derived, e.g., keyed hash of pseudonym + server salt) for manual/QR comparison,
- two users compare codes on first private contact (modeled conceptually on Signal safety numbers / SimpleX security codes — UI only in V1, backed by real pubkeys in E2EE milestone).

## Why not "zero identity"?

A zero-identifier system (SimpleX-style) needs per-user local key material, device-portable encrypted DBs, and no central account authority. OFF is a hosted web community; adopting that removes accounts, breaks RLS-driven moderation, and destroys the community model OFF is built around. That is a *different* product. OFF's authenticity comes from **precision**, not from a slogan.

## Decision record

- Keep username + password sign-in. (Required)
- Remove Google OAuth completely. (Part 3)
- Drop requirement for bio/avatar/country/interests during onboarding. (Parts 17/18)
- Keep minimal optional profile fields (display guidelines) for later.
- Document derived pseudo-email in code + docs, so it is never mistaken for a real email.