# OFF — PRIVACY-THREAT-MODEL.md

Actor-by-actor capabilities. No "untraceable" claims. OFF's honest baseline: content is readable by OFF's backend infrastructure (TLS + provider storage at rest); E2EE is a future milestone.

## Baseline statements

- Transport: TLS between browser and Cloudflare; TLS between Worker and Supabase API.
- Storage: Supabase stores messages/profiles in plaintext at the DB layer (provider storage-at-rest applies at the hosting layer).
- Realtime: Supabase Realtime pushes message rows over (TLS) websockets to subscribers; the realtime infra sees row-level events.
- No E2EE in V1. Any statement below that avoids "only the author and recipient can read the content" is deliberate.

## Actor matrix

| Actor | Can see | Cannot see | Should be reduced | Currently stored |
|---|---|---|---|---|
| Anonymous visitor | public landing/auth page; nothing else | rooms/messages (RLS blocks anon reads) | — | nothing (no visitor analytics) |
| OFF frontend (browser) | everything the signed-in user can see (this IS the user's app) | — | — | — |
| OFF Worker (static host) | served static bundle; request origin/IP to Workers | no DB access (no bindings yet) | — | no app data; edge logs may include request metadata |
| Supabase API/Postgres | all rows for anon+authenticated roles subject to RLS; schema | content of rows user lacks RLS to read | service-role/migration paths stay off-client | full DB (see DATA-OWNERSHIP) |
| Supabase Auth | identities, pseudo-emails, password hashes, session activity | message content (separate store) | keep minimum user fields on auth accounts | auth.users row per user |
| Database administrator (Supabase ops) | raw DB, full contents (honest) — same as any managed DB | — | set retention, never ship service-role to client | full DB |
| Realtime infrastructure | row events (insert/update/delete) on messages for subscribed channels | message bodies only via SQES-channel payload (which CAN include content) | keep realtime payloads minimal; avoid sending content when not needed (future) | transient |
| Cloudflare (edge) | TLS-terminated HTTP requests; IPs; static assets | message content in clear (TLS) under default regimes | — | edge request/log metadata |
| Network observer (in-session) | which host is contacted; HTTPS sizes/timing | message content (TLS) | — | — |
| Other users | profile pseudonym, messages you post in rooms you share, presence of a public profile | private/gated rooms, DM content unless they are a participant, your password | suggest not to expose last-seen/typing (opt-in only) | your public messages, your pseudonym |
| Room owner | membership list of their room, messages in their room (per RLS; owner can manage members/messages where policy allows) | DM threads they are not in | — | memberships, room messages |
| Malicious user | public surface; can attempt requests, rate-limit UI, spam DMs (requests) | content of private/unjoined rooms (RLS) | enforce rate limits, request limits, block vs abuse (V1.1) | any public messages they send |

## Threat reductions targeted by the V1 pivot

1. **Username enumeration**: signup checker returns availability via `username_status` RPC; keep rate-limited and only expose it to authenticated signup context where possible.
2. **DM privacy**: DMs gated by `can_access_thread` RLS; add request accept/reject so a stranger cannot force content into your inbox (V1.1).
3. **Profile enumeration**: World + auth surfaces show only pseudonym; do not expose last-seen/typing by default (privacy settings, Parts 12).
4. **Spam/abuse**: no invitation-path spam exists yet; V1.1 adds request limits + rate limits (Part 16).
5. **Metadata hygiene**: never auto-collect IP/location into app tables; country stays user-declared and private until a community feature needs it.

## Explicit non-claims

- OFF does **not** hide traffic from Cloudflare/Supabase.
- OFF does **not** provide deniable or zero-retention messaging in V1.
- OFF does **not** hide who talks to whom from hosting infrastructure.
- "Private" in V1 means *private from other OFF users via RLS*, not private from OFF's operators.