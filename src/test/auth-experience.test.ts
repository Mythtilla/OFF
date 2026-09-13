import { describe, expect, it } from "vitest";
import { passwordLevel, levelLabel } from "../services/auth/strength";
import { checkUsername } from "../services/auth/availability";
import { senderName } from "../services/profiles/map";
import {
  groupMessages,
  type MessageGroup,
  type PendingMessage,
} from "../services/chat/messages";

const profile = (id: string, username: string, display_name: string | null) => ({
  id,
  username,
  display_name,
  avatar_url: null,
});

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

describe("password strength", () => {
  it("marks anything under 6 characters too-short", () => {
    expect(passwordLevel("")).toBe("too-short");
    expect(passwordLevel("abc12")).toBe("too-short");
  });
  it("flags common and repeated passwords as weak", () => {
    expect(passwordLevel("password")).toBe("weak");
    expect(passwordLevel("12345678")).toBe("weak");
    expect(passwordLevel("aaaaaa")).toBe("weak");
  });
  it("ranks a long mixed password very-strong", () => {
    expect(passwordLevel("Tricky#Kitten2026!")).toBe("very-strong");
  });
  it("distinguishes fair and strong", () => {
    expect(passwordLevel("abcdefg1")).toBe("fair");
    expect(passwordLevel("Abcdef1!")).toBe("strong");
  });
  it("treats a 6-char password with one class as weak, not fair", () => {
    expect(passwordLevel("abcde1")).toBe("weak");
    expect(passwordLevel("abcde!")).toBe("weak");
  });
  it("rewards a second character class once 8 characters are present", () => {
    expect(passwordLevel("abcde1!")).toBe("fair");
    expect(passwordLevel("abcdef12")).toBe("fair");
    expect(passwordLevel("abcdef1!")).toBe("strong");
  });
  it("respects the visual meter boundary at 12 characters", () => {
    expect(passwordLevel("abcdefghijkl")).toBe("fair");
    expect(passwordLevel("ABCDEFGHIJKL")).toBe("fair");
  });
  it("exposes readable labels", () => {
    expect(levelLabel.weak).toBe("Weak");
    expect(levelLabel["very-strong"]).toBe("Very strong");
  });
});

describe("username availability", () => {
  const stub = (available: boolean, suggestions: string[]) =>
    async () => ({ available, suggestions });

  it("reports available when the RPC returns available", async () => {
    const result = await checkUsername("ada", stub(true, []));
    expect(result.status).toBe("available");
  });
  it("reports unavailable with suggestions", async () => {
    const result = await checkUsername("ada", stub(false, ["ada1", "ada_off"]));
    expect(result.status).toBe("unavailable");
    expect(result.suggestions).toContain("ada1");
  });
  it("injects the canonicalized name", async () => {
    let seen = "";
    const result = await checkUsername("  Ada ", async (name) => {
      seen = name;
      return { available: true, suggestions: [] };
    });
    expect(seen).toBe("ada");
    expect(result.status).toBe("available");
  });
  it("returns idle for empty input", async () => {
    expect(await checkUsername("", stub(true, []))).toMatchObject({ status: "idle" });
    expect(await checkUsername("   ", stub(true, []))).toMatchObject({ status: "idle" });
  });
  it("marks invalid names as invalid", async () => {
    expect(await checkUsername("AB", stub(true, []))).toMatchObject({ status: "invalid" });
    expect(await checkUsername("with space", stub(true, []))).toMatchObject({ status: "invalid" });
  });
  it("falls back to idle when the lookup throws", async () => {
    const boom = async () => {
      throw new Error("offline");
    };
    expect(await checkUsername("ada", boom)).toMatchObject({ status: "idle" });
  });
});

describe("sender naming", () => {
  const ada = profile("u1", "ada", "Ada L.");
  it("prefers display_name then username", () => {
    expect(senderName("u1", { u1: ada }, null)).toBe("Ada L.");
    expect(senderName("u1", { u1: { ...ada, display_name: null } }, null)).toBe("ada");
  });
  it("embeds the profile when the map misses", () => {
    expect(senderName("u2", {}, ada)).toBe("Ada L.");
  });
  it("falls back to Unknown member", () => {
    expect(senderName("u9", {}, null)).toBe("Unknown member");
  });
});

describe("message grouping", () => {
  it("groups consecutive messages by sender", () => {
    const groups = groupMessages([
      row({ id: "a", sender_id: "u1" }),
      row({ id: "b", sender_id: "u1" }),
      row({ id: "c", sender_id: "u2" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(groups[1].messages.map((m) => m.id)).toEqual(["c"]);
  });
  it("splits when the same sender is interrupted", () => {
    const groups = groupMessages([
      row({ id: "a", sender_id: "u1" }),
      row({ id: "b", sender_id: "u2" }),
      row({ id: "c", sender_id: "u1" }),
    ]);
    expect(groups).toHaveLength(3);
  });
  it("keeps type contract for the group head", () => {
    const groups: MessageGroup[] = groupMessages([row({ id: "a", sender_id: "u1" })]);
    expect(groups[0].sender_id).toBe("u1");
  });
});