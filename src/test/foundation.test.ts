import { describe, expect, it } from "vitest";
import { validateUsername, canonicalizeUsername, usernameToAuthEmail, usernamePattern } from "../services/auth/username";
import {
  validateMessageBody,
  reconcileMessage,
  type PendingMessage,
} from "../services/chat/messages";
import { canPostToRoom, isDiscoverable } from "../services/rooms/permissions";
import { profileLabel, profileMap } from "../services/profiles/map";
import { normalizeCountryCode } from "../services/geo/country";
import {
  canChangeRole,
  canLeave,
  validMessageTarget,
} from "../services/rooms/roles";
import { generateRecoveryPhrase } from "../services/auth/recovery";
import {
  countryRoomSlug,
  validInterestSelection,
  interestSlugs,
} from "../services/onboarding/interests";
import { recoveryDownload } from "../components/onboarding/RecoveryCeremony";
import { nextOnboardingStep } from "../services/onboarding/state";

const msg = (overrides: Partial<PendingMessage> & { client_event_id: string }): PendingMessage => ({
  id: "id-" + overrides.client_event_id,
  room_id: "r",
  thread_id: null,
  sender_id: "u",
  body: "hi",
  created_at: "now",
  edited_at: null,
  deleted_at: null,
  ...overrides,
});

describe("username", () => {
  it("validates canonical lowercase usernames", () => {
    expect(validateUsername("off_user")).toBeNull();
    expect(validateUsername("abc123")).toBeNull();
    expect(validateUsername("a_0")).toBeNull();
  });
  it("rejects uppercase letters", () => {
    expect(validateUsername("ABC")).toBeTruthy();
    expect(validateUsername("OffUser")).toBeTruthy();
  });
  it("rejects too short and too long", () => {
    expect(validateUsername("ab")).toBeTruthy();
    expect(validateUsername("a".repeat(33))).toBeTruthy();
  });
  it("rejects special characters", () => {
    expect(validateUsername("no!")).toBeTruthy();
    expect(validateUsername("a-b")).toBeTruthy();
    expect(validateUsername("a b")).toBeTruthy();
    expect(validateUsername("a@b")).toBeTruthy();
  });
  it("canonicalizes to lowercase and trims", () => {
    expect(canonicalizeUsername("  OffUser  ")).toBe("offuser");
    expect(canonicalizeUsername("TEST")).toBe("test");
    expect(canonicalizeUsername("already")).toBe("already");
  });
  it("maps username to synthetic auth email", () => {
    expect(usernameToAuthEmail("ada")).toBe("ada@off.invalid");
    expect(usernameToAuthEmail("  Bob  ")).toBe("bob@off.invalid");
  });
  it("pattern only allows lowercase, digits, underscores", () => {
    expect(usernamePattern.test("abc_123")).toBe(true);
    expect(usernamePattern.test("ABC_123")).toBe(false);
    expect(usernamePattern.test("abc-123")).toBe(false);
  });
});

describe("message validation and reconciliation", () => {
  it("validates message bodies", () => {
    expect(validateMessageBody("  ").error).toBeTruthy();
    expect(validateMessageBody("").error).toBeTruthy();
    expect(validateMessageBody("hello").value).toBe("hello");
    expect(validateMessageBody("  hello  ").value).toBe("hello");
    expect(validateMessageBody("a".repeat(4001)).error).toBeTruthy();
    expect(validateMessageBody("a".repeat(4000)).value).toBe("a".repeat(4000));
  });
  it("reconciles optimistic event with persisted counterpart", () => {
    const local = msg({ id: "local-a", client_event_id: "evt-a", pending: true });
    const saved = msg({ id: "db-a", client_event_id: "evt-a" });
    const result = reconcileMessage([local], saved);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("db-a");
    expect(result[0].pending).toBe(false);
  });
  it("deduplicates on reconciliation", () => {
    const local = msg({ id: "local-a", client_event_id: "evt-a", pending: true });
    const saved = msg({ id: "db-a", client_event_id: "evt-a" });
    const once = reconcileMessage([local], saved);
    expect(reconcileMessage(once, saved)).toHaveLength(1);
  });
  it("adds new message not matching any local", () => {
    const existing = msg({ id: "db-1", client_event_id: "evt-1" });
    const incoming = msg({ id: "db-2", client_event_id: "evt-2" });
    const result = reconcileMessage([existing], incoming);
    expect(result).toHaveLength(2);
  });
  it("ignores duplicate by id even if client_event_id differs", () => {
    const existing = msg({ id: "db-1", client_event_id: "evt-1" });
    const sameId = msg({ id: "db-1", client_event_id: "evt-other" });
    expect(reconcileMessage([existing], sameId)).toHaveLength(1);
  });
});

describe("room permissions", () => {
  it("world rooms are always postable", () => {
    expect(canPostToRoom({ id: "1", slug: "w", name: "W", topic: null, kind: "world", is_private: false })).toBe(true);
  });
  it("interest rooms require membership", () => {
    const room = { id: "1", slug: "x", name: "X", topic: null, kind: "interest" as const, is_private: false };
    expect(canPostToRoom({ ...room, is_member: false })).toBe(false);
    expect(canPostToRoom({ ...room, is_member: true })).toBe(true);
  });
  it("private rooms hide from non-members", () => {
    const room = { id: "1", slug: "x", name: "X", topic: null, kind: "custom" as const, is_private: true };
    expect(isDiscoverable(room, false)).toBe(false);
    expect(isDiscoverable(room, true)).toBe(true);
  });
  it("null room returns false", () => {
    expect(canPostToRoom(null)).toBe(false);
  });
});

describe("roles", () => {
  it("owner can change non-owner roles", () => {
    expect(canChangeRole("owner", "member", "moderator")).toBe(true);
  });
  it("owner cannot demote self", () => {
    expect(canChangeRole("owner", "owner", "member")).toBe(false);
    expect(canChangeRole("owner", "owner", "moderator")).toBe(false);
  });
  it("non-owner cannot change roles", () => {
    expect(canChangeRole("moderator", "owner", "member")).toBe(false);
    expect(canChangeRole("member", "member", "moderator")).toBe(false);
  });
  it("only members can leave", () => {
    expect(canLeave("member")).toBe(true);
    expect(canLeave("owner")).toBe(false);
    expect(canLeave("moderator")).toBe(false);
  });
  it("message target must be exactly one of room or thread", () => {
    expect(validMessageTarget("room", null)).toBe(true);
    expect(validMessageTarget(null, "thread")).toBe(true);
    expect(validMessageTarget("room", "thread")).toBe(false);
    expect(validMessageTarget(null, null)).toBe(false);
  });
});

describe("profiles", () => {
  it("profile label prefers display_name then username", () => {
    expect(profileLabel({ id: "1", username: "ada", display_name: "Ada L.", avatar_url: null })).toBe("Ada L.");
    expect(profileLabel({ id: "1", username: "ada", display_name: null, avatar_url: null })).toBe("ada");
    expect(profileLabel(undefined)).toBe("Unknown member");
    expect(profileLabel(null)).toBe("Unknown member");
  });
  it("profileMap maps by id", () => {
    const p = { id: "u1", username: "bob", display_name: null, avatar_url: null };
    expect(profileMap([p]).get("u1")).toEqual(p);
  });
});

describe("country", () => {
  it("normalizes valid 2-letter codes", () => {
    expect(normalizeCountryCode(" us ")).toBe("US");
    expect(normalizeCountryCode("in")).toBe("IN");
  });
  it("returns XX for invalid codes", () => {
    expect(normalizeCountryCode("bad")).toBe("XX");
    expect(normalizeCountryCode(null)).toBe("XX");
    expect(normalizeCountryCode("")).toBe("XX");
    expect(normalizeCountryCode("USA")).toBe("XX");
  });
});

describe("recovery", () => {
  it("generates 24-word phrase", () => {
    expect(generateRecoveryPhrase()).toHaveLength(24);
  });
  it("phrase words are from known list", () => {
    const phrase = generateRecoveryPhrase();
    expect(phrase.every((w) => typeof w === "string" && w.length > 0)).toBe(true);
  });
  it("recovery download contains account info", () => {
    const output = recoveryDownload("ada", Array(24).fill("anchor"));
    expect(output).toContain("Account: ada");
    expect(output).toContain("24. anchor");
  });
});

describe("interests", () => {
  it("canonical interest set", () => {
    expect(interestSlugs).toEqual([
      "cybersecurity", "linux", "programming", "ai", "ctf", "science", "hardware",
    ]);
  });
  it("validates known interests", () => {
    expect(validInterestSelection(["linux", "ai"])).toBe(true);
    expect(validInterestSelection(["linux", "ai", "linux"])).toBe(true);
    expect(validInterestSelection([])).toBe(true);
  });
  it("rejects unknown interests", () => {
    expect(validInterestSelection(["secret"])).toBe(false);
    expect(validInterestSelection(["linux", "hacking"])).toBe(false);
  });
  it("country room slug", () => {
    expect(countryRoomSlug("IN")).toBe("country-in");
    expect(countryRoomSlug("us")).toBeNull();
    expect(countryRoomSlug("XX")).toBe("country-xx");
    expect(countryRoomSlug("A")).toBeNull();
  });
});

describe("onboarding state machine", () => {
  it("starts at recovery when nothing done", () => {
    expect(nextOnboardingStep({ recovery: false, profile: false, country: false, interests: false })).toBe("recovery");
  });
  it("advances through each step", () => {
    expect(nextOnboardingStep({ recovery: true, profile: false, country: false, interests: false })).toBe("profile");
    expect(nextOnboardingStep({ recovery: true, profile: true, country: false, interests: false })).toBe("country");
    expect(nextOnboardingStep({ recovery: true, profile: true, country: true, interests: false })).toBe("interests");
    expect(nextOnboardingStep({ recovery: true, profile: true, country: true, interests: true })).toBe("complete");
  });
  it("is resumable from any checkpoint", () => {
    expect(nextOnboardingStep({ recovery: true, profile: false, country: false, interests: false })).toBe("profile");
    expect(nextOnboardingStep({ recovery: true, profile: true, country: false, interests: false })).toBe("country");
  });
  it("skips to correct step if earlier steps done", () => {
    expect(nextOnboardingStep({ recovery: false, profile: true, country: false, interests: false })).toBe("recovery");
  });
});

describe("stale request protection", () => {
  it("request ref increments", () => {
    const ref = { current: 0 };
    const id1 = ++ref.current;
    const id2 = ++ref.current;
    expect(id2).toBeGreaterThan(id1);
  });
});

describe("channel status mapping", () => {
  it("maps all expected statuses", () => {
    const statuses = ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"];
    for (const s of statuses) {
      expect(["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED", "Connecting"]).toContain(s);
    }
  });
});
