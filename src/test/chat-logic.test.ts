import { describe, expect, it } from "vitest";
import {
  missingSenderIds,
  mergeSenderBatch,
} from "../services/chat/senders";
import {
  channelStatusLabel,
  type ChannelStatus,
} from "../services/chat/status";
import type { Profile } from "../services/chat/types";

const profile = (id: string): Profile => ({
  id,
  username: "user" + id,
  display_name: null,
  avatar_url: null,
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