export type CountryDetection = {
  code: string;
  displayName: string;
  source: "edge-header" | "unresolved";
};
export function normalizeCountryCode(value: string | null | undefined) {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : "XX";
}
/** Client-safe boundary: production detection occurs server-side from trusted edge headers only. */
export async function detectCurrentCountry(): Promise<CountryDetection> {
  return { code: "XX", displayName: "Unresolved region", source: "unresolved" };
}
