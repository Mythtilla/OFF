# OFF — V1-FEATURE-SPEC.md

Version tiers and precise feature staging. Optimize for privacy, security, simplicity, usability, reliability, maintainability.

## V1 REQUIRED (this release)

Identity & auth
- Username + password account (keep). Remove Google OAuth.
- Exact-statement copy: "OFF stores a pseudonym and a derived internal auth email; no phone, no real email, no real name."
- Autofill-friendly form (username, password), strength meter, username availability check.
- Honest recovery placeholder retained and clearly labeled. Real recovery = future.

Onboarding (reset to minimal)
- Flow: create identity → privacy options (defaults) → enter World.
- Remove the 4-step bloat if safe: keep the acknowledgement RPCs but make privacy options a single lightweight step. Options: who can contact me, who can find me (V1), read receipts/typing indicator defaults off (V1.1 UI toggles). The important V1 change is: no country/interests questionnaire before entering World.

World & messaging
- World = the only public room in the clean database (single default conversation). Preserve room/community schema.
- Chat: send, edit own, delete own (soft), reply-to-message, grouping, timestamps, sender identity, reconnect/empty/loading states, new-message indicator.
- Message request system for private contacts (V1 core): inbound DM from a non-connection appears as a Request; accept → thread; reject → discard; block → no new requests.

Privacy & security basics
- Blocking server-enforced (table + RLS), not just frontend.
- Message request limits + signup/join rate limits (privacy-preserving; DB-level; no tracking).
- Account deletion flow documented and UI-stubbed (V1.1 executes deletion RPC).
- Stale session/refresh hygiene (already provider-level; verify timebox config).

UI
- Mobile + desktop navigation per Parts 19/20: bottom nav (Home/Chats/Communities/You), desktop left rail; keep OFF's dark technical identity (Part 29).
- Accessibility: 44px targets, aria-live, one h1 per view, focus-visible, labels not placeholders.

## V1.1

- Block list management UI; report-to-moderation (basic).
- Disappearing messages (OFF, 1m/5m/1h/1d/1w) — client-enforced, with the honest limits table (screenshots, forwarded copies, server can't delete what it can't see).
- Typing indicators / read / delivery receipts and online presence as **explicit opt-in** privacy settings (default off).
- Privacy & Security settings screen where every toggle changes client behavior or a realtime subscription (not visual-only).
- Data export (account data dump via DB RPC, format JSON/MD).
- Invite/connection codes + QR verification surface (UI; crypto binding when E2EE lands).
- Username search only when a user enables "findable".

## FUTURE (roadmap only)

- E2EE DMs via established library (E2EE-ROADMAP M1).
- Multi-device session/key reconcile.
- E2EE-split community moderation.
- Real recovery (key-based backup with documented guarantees).
- Attachments: server-side re-encode + metadata cleaning pipeline + encrypted at rest.
- Community directory / channels / tags (architecture preserved, not seeded).

## Explicitly REJECTED for OFF

- Fake "anonymity" claims.
- Phone/login-less "zero identity" theater while storing accounts.
- Read receipts/typing/presence as always-on defaults.
- Link previews that fetch external URLs from the client.
- Any tracking/analytics/fingerprinting.
- Custom crypto.

## World header / first-run experience (Part 21)

- Header shows room name + truthful realtime state (`○ Connecting…`, `● Live` only when SUBSCRIBED).
- Empty state: "World is quiet right now — start the conversation." (honest, no fake seed chatter).
- Composer disabled until a room is active; reply affordance on hover (desktop) / long-press (mobile).
- Message actions: reply, copy, edit (author), delete (author).
- New-message indicator (scroll-to-bottom button appears when scrolled up).

## Model mental hierarchy (Part 7)

```
COMMUNITIES          PUBLIC: World (V1) → future channels
CONVERSATIONS        rooms / threads inside a community
MESSAGES             grouped by sender, threaded, actions
└─ PRIVATE           DIRECT CONVERSATIONS: invite → request → accept → thread
```