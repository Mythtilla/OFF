import { describe, expect, it } from "vitest";
import {
  layoutForViewport,
  groupRooms,
  visibleRooms,
  NAV_SECTIONS,
  MIN_SUPPORTED_WIDTH,
  MOBILE_MAX,
  TABLET_MAX,
  type LayoutMode,
} from "../services/navigation/layout";
import type { Room } from "../services/chat/types";

const room = (overrides: Partial<Room> & { id: string }): Room => ({
  slug: "s" + overrides.id,
  name: "Room " + overrides.id,
  topic: null,
  kind: "custom",
  is_private: false,
  ...overrides,
});

describe("viewport layout mode", () => {
  const cases: [number, LayoutMode][] = [
    [MIN_SUPPORTED_WIDTH - 1, "mobile"],
    [320, "mobile"],
    [360, "mobile"],
    [375, "mobile"],
    [390, "mobile"],
    [414, "mobile"],
    [430, "mobile"],
    [MOBILE_MAX, "mobile"],
    [768, "tablet"],
    [900, "tablet"],
    [1024, "tablet"],
    [TABLET_MAX, "tablet"],
    [1200, "desktop"],
    [1280, "desktop"],
    [1440, "desktop"],
    [1920, "desktop"],
  ];
  for (const [width, expected] of cases) {
    it(`maps ${width}px to ${expected}`, () => {
      expect(layoutForViewport(width)).toBe(expected);
    });
  }
  it("defines a sane minimum supported width", () => {
    expect(MIN_SUPPORTED_WIDTH).toBe(320);
  });
});

describe("room sectioning", () => {
  it("groups rooms by kind in a stable order", () => {
    const rooms = [
      room({ id: "c", kind: "custom", name: "Zed" }),
      room({ id: "a", kind: "world", name: "World" }),
      room({ id: "i", kind: "interest", name: "Linux" }),
      room({ id: "cc", kind: "country", name: "India" }),
    ];
    const sections = groupRooms(rooms);
    expect(sections.map((s) => s.id)).toEqual(["world", "country", "interest", "custom"]);
  });
  it("omits empty sections", () => {
    const sections = groupRooms([room({ id: "w", kind: "world", name: "World" })]);
    expect(sections.map((s) => s.id)).toEqual(["world"]);
  });
  it("sorts alphabetically within a section", () => {
    const sections = groupRooms([
      room({ id: "z", kind: "interest", name: "Z" }),
      room({ id: "a", kind: "interest", name: "A" }),
      room({ id: "m", kind: "interest", name: "M" }),
    ]);
    expect(sections[0].rooms.map((r) => r.name)).toEqual(["A", "M", "Z"]);
  });
  it("section titles match the expected vocabulary", () => {
    expect(NAV_SECTIONS.map((s) => s.title)).toEqual([
      "WORLD",
      "COUNTRY",
      "INTERESTS",
      "COMMUNITIES",
    ]);
  });
  it("never fabricates an unknown kind section", () => {
    const rooms = [room({ id: "x", kind: "custom", name: "X" })];
    const sections = groupRooms(rooms);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("custom");
  });
});

describe("private room visibility", () => {
  it("hides private rooms from non-members", () => {
    const privateRoom = room({ id: "p", is_private: true });
    expect(visibleRooms([privateRoom], new Set())).toEqual([]);
  });
  it("shows private rooms to their members", () => {
    const privateRoom = room({ id: "p", is_private: true });
    expect(visibleRooms([privateRoom], new Set(["p"]))).toHaveLength(1);
  });
  it("always shows public rooms", () => {
    const publicRoom = room({ id: "q", is_private: false });
    expect(visibleRooms([publicRoom], new Set())).toHaveLength(1);
  });
});