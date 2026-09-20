export type MentionEntry = { id: string; username: string; displayName?: string | null };

export type BioSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; token: string; username: string; id: string };

const TOKEN_RE = /@([a-zA-Z0-9_]{3,32})(?![a-zA-Z0-9_])/g;

export function tokenizeMentions(text: string): string[] {
  return Array.from(text.matchAll(TOKEN_RE), (m) => m[1].toLowerCase());
}

/**
 * Splits bio text into plain text and @mention segments. A mention only links
 * when its username resolves to a known, non-blocked account; otherwise it is
 * rendered as plain text (the review requires graceful fallbacks for renamed
 * or blocked accounts).
 */
export function buildBioSegments(
  text: string,
  mentions: MentionEntry[],
  blocked: Set<string>,
): BioSegment[] {
  if (!text) return [];
  const byUsername = new Map(mentions.map((m) => [m.username.toLowerCase(), m]));
  const segments: BioSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) segments.push({ kind: "text", text: text.slice(last, match.index) });
    const token = match[0];
    const username = match[1].toLowerCase();
    const entry = byUsername.get(username);
    if (entry && entry.id && !blocked.has(entry.id)) {
      segments.push({ kind: "mention", token, username, id: entry.id });
    } else {
      segments.push({ kind: "text", text: token });
    }
    last = match.index + token.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}