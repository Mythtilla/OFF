import type { Room } from "../chat/types";

export const MIN_SUPPORTED_WIDTH = 320;
export const MOBILE_MAX = 767;
export const TABLET_MAX = 1199;

export type LayoutMode = "mobile" | "tablet" | "desktop";

export function layoutForViewport(width: number): LayoutMode {
  if (width < MOBILE_MAX + 1) return "mobile";
  if (width < TABLET_MAX + 1) return "tablet";
  return "desktop";
}

export const NAV_SECTIONS = [
  { id: "world", title: "WORLD", kinds: ["world"] },
  { id: "country", title: "COUNTRY", kinds: ["country"] },
  { id: "interest", title: "INTERESTS", kinds: ["interest"] },
  { id: "custom", title: "COMMUNITIES", kinds: ["custom"] },
] as const;

export type NavSection = {
  id: string;
  title: string;
  rooms: Room[];
};

export function groupRooms(rooms: Room[]): NavSection[] {
  const byKind = (kinds: string[]) =>
    rooms
      .filter((room) => kinds.includes(room.kind))
      .sort((a, b) => a.name.localeCompare(b.name));
  return NAV_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    rooms: byKind([...section.kinds]),
  })).filter((section) => section.rooms.length > 0);
}

export function visibleRooms(rooms: Room[], isMember: ReadonlySet<string>) {
  return rooms.filter((room) => !room.is_private || isMember.has(room.id));
}