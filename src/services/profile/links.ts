export type LinkVisibility = "only_me" | "connections" | "everyone";

export const LINK_VISIBILITY_OPTIONS: LinkVisibility[] = ["only_me", "connections", "everyone"];

// Mirror of the profile_links_url_scheme CHECK in the migration.
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  const lowered = trimmed.toLowerCase();
  if (!lowered.startsWith("http://") && !lowered.startsWith("https://")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function validateLinkUrl(raw: string): string | null {
  if (!raw.trim()) return null;
  return normalizeLinkUrl(raw) ? null : "Use a full link starting with http:// or https://";
}

export type ProfileLink = { label: string; url: string; visibility: LinkVisibility };

/**
 * Which links a given viewer may see. Owner sees everything; otherwise the
 * per-link visibility is honored with "connections" gated on shared context.
 */
export function visibleLinks(
  links: ProfileLink[],
  ctx: { self: boolean; connected: boolean },
): ProfileLink[] {
  return links
    .filter(
      (l) =>
        ctx.self ||
        l.visibility === "everyone" ||
        (l.visibility === "connections" && ctx.connected),
    )
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}