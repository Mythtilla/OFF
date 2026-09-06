export const usernamePattern = /^[a-z0-9_]{3,32}$/;
export function canonicalizeUsername(username: string) { return username.trim().toLowerCase() }
export function validateUsername(username: string) {
  return usernamePattern.test(username)
    ? null
    : "Use 3–32 letters, numbers, or underscores.";
}
/** Temporary Supabase Auth transport mapping. Keep internal and replaceable. */
export function usernameToAuthEmail(username: string) {
  return `${canonicalizeUsername(username)}@off.invalid`;
}
