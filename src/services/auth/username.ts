export const usernamePattern = /^[a-z0-9_]{3,32}$/;
export function canonicalizeUsername(username: string) { return username.trim().toLowerCase() }
export function validateUsername(username: string) {
  if (!username) return null;
  return usernamePattern.test(username)
    ? null
    : "Use 3–32 lowercase letters, numbers, or underscores.";
}
/** Temporary Supabase Auth transport mapping. Keep internal and replaceable. */
export const AUTH_EMAIL_DOMAIN = "off.app";
/**
 * Maps a username to the internal Supabase Auth pseudo-email transport.
 *
 * Contract (keep internal and replaceable):
 *   • Given a non-empty username: deterministic `canonical(username)@off.app`.
 *   • Given an empty/null username (pre-signup / anonymous placeholder flow):
 *     `anon-<time36>@off.app` — non-deterministic, used only as a transport
 *     address before the real username is committed; never surfaced to the user
 *     or used for identity resolution after signup completes.
 *   • The domain is a synthetic transport address, not a real mailbox.
 */
export function usernameToAuthEmail(username: string) {
  if (!username) {
    const timestamp = Date.now().toString(36).substring(0, 6);
    return `anon-${timestamp}@${AUTH_EMAIL_DOMAIN}`;
  }
  return `${canonicalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}
