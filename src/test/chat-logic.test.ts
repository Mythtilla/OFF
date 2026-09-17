import { describe, expect, it } from "vitest";
import {
  missingSenderIds,
  mergeSenderBatch,
} from "../services/chat/senders";
import {
  channelStatusLabel,
  type ChannelStatus,
} from "../services/chat/status";
import {
  buildRenderList,
  reconcileDelete,
  reconcileMessage,
  reconcileUpdate,
  relativeTime,
  shortTime,
  type PendingMessage,
} from "../services/chat/messages";
import { groupPreviews } from "../services/chat/previews";
import type { Message, Profile } from "../services/chat/types";

const profile = (id: string): Profile => ({
  id,
  username: "user" + id,
  display_name: null,
  avatar_url: null,
});

const message = (overrides: Partial<Message> = {}, index = 1): Message => ({
  id: `m${index}`,
  room_id: "r1",
  thread_id: null,
  sender_id: "u1",
  body: `body ${index}`,
  client_event_id: `e${index}`,
  created_at: `2026-09-17T10:0${Math.min(index, 9) - 1}:00Z`,
  edited_at: null,
  deleted_at: null,
  ...overrides,
});

describe("sender id batching", () => {
  const ada = profile("u1");
  it("reports only unknown sender ids", () => {
    expect(missingSenderIds(["u1", "u2", "u1"], { u1: ada })).toEqual(["u2"]);
  });
  it("deduplicates missing ids", () => {
    expect(missingSenderIds(["u1", "u1", "u3"], {})).toEqual(["u1", "u3"]);
  });
  it("returns empty when everything is known", () => {
    expect(missingSenderIds(["u1"], { u1: ada })).toEqual([]);
  });
  it("returns empty for no senders", () => {
    expect(missingSenderIds([], {})).toEqual([]);
  });
  it("merge preserves existing entries and adds new rows", () => {
    const merged = mergeSenderBatch({ u1: ada }, [profile("u2")]);
    expect(Object.keys(merged).sort()).toEqual(["u1", "u2"]);
    expect(merged.u1).toEqual(ada);
  });
  it("merge overwrites a previously-missing id present in a later batch", () => {
    const merged = mergeSenderBatch(
      { u1: ada },
      [profile("u1"), profile("u2")],
    );
    expect(merged.u1.display_name).toBeNull();
    expect(merged.u2.username).toBe("useru2");
  });
});

describe("channel status label", () => {
  const cases: [ChannelStatus, string][] = [
    ["SUBSCRIBED", "● Live"],
    ["Connecting", "○ Connecting…"],
    ["CHANNEL_ERROR", "● Error"],
    ["TIMED_OUT", "● Timed out"],
    ["CLOSED", "● Disconnected"],
  ];
  for (const [status, label] of cases) {
    it(`maps ${status} to "${label}"`, () => {
      expect(channelStatusLabel(status)).toBe(label);
    });
  }
  it("is exhaustive over the ChannelStatus union", () => {
    const statuses: ChannelStatus[] = [
      "SUBSCRIBED",
      "CHANNEL_ERROR",
      "TIMED_OUT",
      "CLOSED",
      "Connecting",
    ];
    statuses.forEach((s) => expect(channelStatusLabel(s)).toBeTruthy());
  });
});

describe("message reconciliation", () => {
  it("reconciles an optimistic insert against its persisted row", () => {
    const optimistic = { ...message({ id: "local-e1" }), pending: true };
    const persisted = message({ id: "m1" });
    const next = reconcileMessage([optimistic], persisted as PendingMessage);
    expect(next).toHaveLength(1);
    expect(next[0].pending).toBe(false);
    expect(next[0].id).toBe("m1");
  });
  it("deduplicates an incoming insert that is already present", () => {
    const existing = message();
    const next = reconcileMessage(
      [existing],
      { ...existing, pending: false } as PendingMessage,
    );
    expect(next).toHaveLength(1);
  });
  it("reconcileUpdate replaces the matching row (edit)", () => {
    const edited = message({ edited_at: "2026-09-17T11:00:00Z" });
    const next = reconcileUpdate(
      [message()],
      { ...edited, pending: false } as PendingMessage,
    );
    expect(next[0].edited_at).toBe("2026-09-17T11:00:00Z");
  });
  it("reconcileDelete drops the row by id", () => {
    const next = reconcileDelete([message(), message({}, 2)], "m1");
    expect(next.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("render list with date separators", () => {
  const blank = new Map<string, string>();
  it("inserts a single lead separator for one day", () => {
    const items = buildRenderList(
      [message(), message({}, 2)],
      blank,
    );
    expect(items.filter((i) => i.kind === "date")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "message")).toHaveLength(2);
  });
  it("flags the first message of a sender run", () => {
    const items = buildRenderList(
      [message(), message({ sender_id: "u2" }, 2)],
      blank,
    );
    const bubbles = items.filter(
      (i): i is Extract<typeof i, { kind: "message" }> => i.kind === "message",
    );
    expect(bubbles[0].first).toBe(true);
    expect(bubbles[1].first).toBe(true);
  });
  it("resolves reply bodies from the message id map", () => {
    const map = new Map<string, string>([["m1", "original text"]]);
    const items = buildRenderList(
      [message({ id: "m1" }), message({ id: "m2", reply_to: "m1" }, 2)],
      map,
    );
    const bubbles = items.filter(
      (i): i is Extract<typeof i, { kind: "message" }> => i.kind === "message",
    );
    expect(bubbles[1].replyBody).toBe("original text");
  });
});

describe("time formatting", () => {
  it("shortTime renders an HH:MM clock", () => {
    expect(shortTime("2026-09-17T10:30:00Z")).toMatch(/^\d{2}:\d{2}$/);
  });
  it("relativeTime shows recent minutes then hours", () => {
    const now = Date.now();
    const minsAgo = new Date(now - 5 * 60000).toISOString();
    const hoursAgo = new Date(now - 3 * 3600000).toISOString();
    expect(relativeTime(minsAgo)).toBe("5m");
    expect(relativeTime(hoursAgo)).toBe("3h");
  });
});

describe("chat list previews", () => {
  it("groups rows to the latest preview per room", () => {
    const rows = [
      { room_id: "r1", body: "old", created_at: "2026-09-17T10:00:00Z" },
      { room_id: "r1", body: "new", created_at: "2026-09-17T10:01:00Z" },
      { room_id: "r2", body: "other", created_at: "2026-09-17T10:02:00Z" },
    ];
    const grouped = groupPreviews(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped).toContainEqual({
      room_id: "r1",
      body: "old",
      created_at: "2026-09-17T10:00:00Z",
    });
  });
});