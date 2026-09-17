export type Preview = { room_id: string; body: string; created_at: string };
/** Collapse a descending-ordered message list into the latest preview per room. */
export function groupPreviews(rows: Preview[]): Preview[] {
  const seen = new Set<string>();
  const result: Preview[] = [];
  for (const row of rows) {
    if (seen.has(row.room_id)) continue;
    seen.add(row.room_id);
    result.push(row);
  }
  return result;
}