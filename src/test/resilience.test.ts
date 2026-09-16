import { describe, expect, it } from "vitest";
import {
  groupMessages,
  reconcileMessage,
  type PendingMessage,
} from "../services/chat/messages";
import { senderName } from "../services/profiles/map";
import { checkUsername } from "../services/auth/availability";
import { onboardingProgress } from "../services/onboarding/progress";
import type { Profile } from "../services/chat/types";

const row = (overrides: Partial<PendingMessage> & { id: string }): PendingMessage => ({
  room_id: "r",
  thread_id: null,
  sender_id: "u",
  body: "hi",
  client_event_id: "evt-" + overrides.id,
  created_at: "now",
  edited_at: null,
  deleted_at: null,
  ...overrides,
});

const profile = (id: string, display_name: string | null = null): Profile => ({
  id,
  username: "user" + id,
  display_name,
  avatar_url: null,
});

describe("reconcile resilience", () => {
  it("is idempotent against a repeated realtime payload by client event id", () => {
    const local = row({ id: "local-a", client_event_id: "evt-a", pending: true });
    const saved = row({ id: "db-a", client_event_id: "evt-a" });
    const once = reconcileMessage([local], saved);
    expect(reconcileMessage(once, saved)).toHaveLength(1);
    expect(reconcileMessage(once, saved)[0].pending).toBe(false);
  });
  it("appends an incoming message onto an empty timeline", () => {
    const incoming = row({ id: "db-1", client_event_id: "evt-1" });
    expect(reconcileMessage([], incoming)).toEqual([{ ...incoming, pending: false }]);
  });
  it("never reorders a stream that is append-only by created_at", () => {
    const older = row({ id: "db-1", client_event_id: "evt-1", created_at: "2026-09-01T00:00:00Z" });
    const delayedOlder = row({ id: "db-2", client_event_id: "evt-2", created_at: "2026-09-01T00:00:01Z" });
    const result = reconcileMessage([older], delayedOlder);
    expect(result.map((m) => m.id)).toEqual(["db-1", "db-2"]);
  });
  it("deduplicates on the server id even across separate events", () => {
    const present = row({ id: "db-1", client_event_id: "evt-1" });
    const duplicate = row({ id: "db-1", client_event_id: "evt-2" });
    expect(reconcileMessage([present], duplicate)).toHaveLength(1);
  });
});

describe("group integrity under partial state", () => {
  it("returns no groups for an empty timeline", () => {
    expect(groupMessages([])).toEqual([]);
  });
  it("preserves the pending flag inside its group", () => {
    const groups = groupMessages([
      row({ id: "a", sender_id: "u1", pending: true }),
      row({ id: "b", sender_id: "u2" }),
    ]);
    expect(groups[0].messages[0].pending).toBe(true);
  });
  it("keeps a single sender as one group regardless of volume", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      row({ id: `m${i}`, sender_id: "u1" }),
    );
    expect(groupMessages(many)).toHaveLength(1);
    expect(groupMessages(many)[0].messages).toHaveLength(5);
  });
});

describe("sender identity precedence", () => {
  it("prefers the resolved map entry over any embedded profile", () => {
    const embedded = profile("u1", "Embedded Name");
    const mapped = profile("u1", "Mapped Name");
    expect(senderName("u1", { u1: mapped }, embedded)).toBe("Mapped Name");
  });
  it("falls back to username before Unknown member", () => {
    expect(senderName("u1", { u1: profile("u1") }, null)).toBe("useru1");
    expect(senderName("u9", {}, null)).toBe("Unknown member");
  });
  it("does not trust a client-supplied sender id as a name", () => {
    expect(senderName("u1", {}, null)).not.toBe("u1");
  });
});

describe("availability failure degradation", () => {
  it("returns idle (not an error) when Supabase is unreachable", async () => {
    const unreachable = async () => {
      throw new Error("fetch failed");
    };
    expect(await checkUsername("ada", unreachable)).toMatchObject({ status: "idle", suggestions: [] });
  });
  it("short-circuits invalid and empty input without hitting the network", async () => {
    let hits = 0;
    const counting = async () => {
      hits += 1;
      return { available: true, suggestions: [] };
    };
    expect(await checkUsername("  ", counting)).toMatchObject({ status: "idle" });
    expect(await checkUsername("AB", counting)).toMatchObject({ status: "invalid" });
    expect(hits).toBe(0);
  });
  it("maps an unhandled RPC reply to the safe idle state", async () => {
    const empty = async () => ({ available: false, suggestions: [] });
    expect(await checkUsername("ada", empty)).toMatchObject({ status: "unavailable" });
  });
});

describe("onboarding progress remainder", () => {
  const done = "2026-09-06T00:00:00.000Z";
  const state = (flags: [string | null, string | null]) => ({
    recovery_acknowledged_at: flags[0],
    profile_completed_at: flags[1],
  });
  it("reports 100% and no current step when finished", () => {
    const p = onboardingProgress(state([done, done]));
    expect(p.percent).toBe(100);
    expect(p.current).toBeNull();
  });
});