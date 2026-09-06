import type { Profile } from "../chat/types";
export function profileMap(profiles: Profile[]) {
  return new Map(profiles.map((profile) => [profile.id, profile]));
}
export function profileLabel(profile: Profile | undefined | null) {
  return profile?.display_name || profile?.username || "Unknown member";
}
