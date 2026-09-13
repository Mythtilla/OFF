# OFF — PRIVACY-RESEARCH.md

Research-derived product principles from SimpleX, Session, Briar, and Signal. OFF does NOT copy these products, protocols, or branding. We extract **principles** and map each to an OFF decision.

## 1. SimpleX

Identity: no phone/email/username — a profile is device-local; "addresses" are delivery routes, not identifiers.
Connection: one-time invite links/QR + persistent user addresses; inbound conversations land as **accept/reject requests**.
Metadata: servers are dumb relays; no shared identifier between contact queues; messages transient.
Local: everything lives in a portable encrypted local DB; loss = permanent unless you manually backed up.
Groups: decentralized, acknowledged to fragment at scale.

**Principles OFF adopts**
- Conversation initiation is **request-based** (accept/reject/block) — no global searchable identifier.
- A **shareable invite link** that carries only the means to start a conversation.
- Honest limits: OFF will never claim server-blindness; server stores messages.
- **Recovery is hard** — OFF must not fake a recovery mechanism.

**Principles OFF rejects**
- Full server-blindness (requires custom relay/messaging infrastructure; not OFF's stack).
- Device-only data (web app; OFF keeps server-side state with RLS).
- User-managed multi-device fragility (OFF keeps an account, honestly).

## 2. Session

Identity: 66-char Ed25519 public key generated on-device; usernames optional convenience.
Connection: share Session ID, paste to add; strangers land in Message Requests; identity verified out-of-band.
Privacy: onion network hides IPs from nodes; acknowledged NOT to be PFS in v1 and vulnerable to global passive traffic analysis.
Servers: decentralized swarm, TTL message expiry (~2 weeks default).
Recovery: 13-word seed re-derives the key; history not fully recoverable.

**Principles OFF adopts**
- **Message Requests inbox** for inbound DMs from non-connections.
- **Identity must be verified out-of-band**; verification ceremony (not magic).
- Expiring/queued message lifetime is a real product decision.
- A long, unguessable identifier also exposes nothing readable → surfaces as an **invite/contact code**.

**Principles OFF rejects**
- Decentralized swarm + blockchain incentives (out of scope for V1).
- Prefix-identity via public key as the only identifier (poor UX for a community platform).

## 3. Briar

Identity: on-device keypair + self-chosen nickname; no phone/email.
Connection: QR scan in person (Bramble protocol), exchange keys; no directory; one-hop mesh; introductions possible.
Threat model: nation-state; Tor for internet transport; local contact list encrypted.
Recovery: essentially none.

**Principles OFF adopts**
- Out-of-band verification via **QR/security-code** is a first-class UX, not an afterthought.
- Local data is minimized and encryptable; backend should store as little as possible.
- "No directory" is a feature OFF can partially inherit (world + private conversations; username search only if explicitly enabled).

**Principles OFF rejects**
- P2P-only transport (OFF is a hosted web community; not offline-first).

## 4. Signal

Identity: phone number (required) or username; **safety numbers** = fingerprints derived from identity public keys.
Connection: message requests; contact discovery by address book; usernames opt-in.
Privacy: E2EE content in transit; Sealed Sender hides sender-from-server for most traffic; server can be compelled to release account timestamps; no social graph/data.
E2EE: Signal Protocol — PQXDH + Double Ratchet, Sender Keys (groups), Sesame (multi-device).
Disappearing messages: client-enforced, device timers, server doesn't know; honest "may be screenshotted/retained" limits.
Recovery: phone + PIN (SVR); message history not recoverable from server; E2EE cloud backups (2025).

**Principles OFF adopts**
- **Verification UX** modeled conceptually on safety numbers: two users confirm identity via a short code.
- Honest disappearing-message limitations (server cannot make copies disappear; screenshots remain).
- **Client-driven semantics**: "deleted for me" must never be claimed as "deleted for everyone" without explicit support.
- Signal-style rate/abuse posture: DMs from strangers = requests; spam controls.

**Principles OFF rejects**
- Phone number requirement (violates the no-PII goal).
- Scope of building a full Signal Protocol implementation in V1 (future roadmap only, via an established library).

## Synthesis: OFF product principles

1. **Identity is minimal**: a pseudonym + password, backed by a real Supabase auth account internally. OFF says exactly what it stores (no email, no phone, no real name; internal derived pseudo-email only).
2. **Conversations are opt-in**: private contact via invite link → message request → accept/reject/block. Nothing is globally searchable by default.
3. **Public = World only** in the clean V1 database; communities are an architecture, not a demo.
4. **Metadata is reduced deliberately**: typing indicators and read receipts are OFF, not on, and only between connections.
5. **Verification is explicit**: connection codes; never claim identity is cryptographically guaranteed in V1.
6. **Honesty over "security theater"**: OFF claims transport encryption today, E2EE as a roadmapped, library-backed future — never claims E2EE before it is implemented and verified.
7. **Usability is a privacy feature**: a privacy app nobody can use protects nothing.