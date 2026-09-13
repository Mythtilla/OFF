import type { Profile } from "../chat/types";
export function senderName(
  senderId: string,
  senders: Readonly<Record<string, Profile>>,
  embedded?: Profile | null,
) {
  const profile = senders[senderId] || embedded || null;
  return profile?.display_name || profile?.username || "Unknown member";
}
