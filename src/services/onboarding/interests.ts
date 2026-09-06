export const interestSlugs = [
  "cybersecurity",
  "linux",
  "programming",
  "ai",
  "ctf",
  "science",
  "hardware",
] as const;
export function validInterestSelection(slugs: string[]) {
  return [...new Set(slugs)].every((slug) =>
    (interestSlugs as readonly string[]).includes(slug),
  );
}
export function countryRoomSlug(code: string) {
  return /^[A-Z]{2}$/.test(code) ? `country-${code.toLowerCase()}` : null;
}
