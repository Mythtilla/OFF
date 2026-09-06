import type { Room } from "../chat/types";
export function canPostToRoom(room: Room | null) {
  return Boolean(room && (room.kind === "world" || room.is_member));
}
export function isDiscoverable(room: Room, isMember: boolean) {
  return !room.is_private || isMember;
}
