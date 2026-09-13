import type { Profile } from "./types";

export function missingSenderIds(
  senderIds: Iterable<string>,
  known: Readonly<Record<string, Profile>>,
) {
  const missing = new Set<string>();
  for (const id of senderIds) {
    if (!known[id]) missing.add(id);
  }
  return [...missing];
}

export function mergeSenderBatch(
  known: Readonly<Record<string, Profile>>,
  rows: Profile[],
) {
  const next = { ...known };
  for (const profile of rows) next[profile.id] = profile;
  return next;
}