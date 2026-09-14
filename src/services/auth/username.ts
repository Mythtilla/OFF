export const usernamePattern = /^[a-z0-9_]{3,32}$/;
export function canonicalizeUsername(username: string) { return username.trim().toLowerCase() }
export function validateUsername(username: string) {
  return usernamePattern.test(username)
    ? null
    : "Use 3–32 lowercase letters, numbers, or underscores.";
}
/** Temporary Supabase Auth transport mapping. Keep internal and replaceable. */
export const AUTH_EMAIL_DOMAIN = "off.app";
export function usernameToAuthEmail(username: string) {
  return `${canonicalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}
