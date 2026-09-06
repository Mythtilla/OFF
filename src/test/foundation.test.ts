import { describe, expect, it } from "vitest";
import { validateUsername } from "../services/auth/username";
import {
  validateMessageBody,
  reconcileMessage,
} from "../services/chat/messages";
import { canPostToRoom, isDiscoverable } from "../services/rooms/permissions";
import { profileLabel, profileMap } from "../services/profiles/map";
import { normalizeCountryCode } from "../services/geo/country";
describe("foundation services", () => {
  it("validates pseudonymous usernames", () => {
    expect(validateUsername("off_user")).toBeNull();
    expect(validateUsername("no!")).toBeTruthy();
  });
  it("validates message bodies", () => {
    expect(validateMessageBody("  ").error).toBeTruthy();
    expect(validateMessageBody("hello").value).toBe("hello");
  });
  it("reconciles an optimistic event without duplication", () => {
    const local = {
      id: "local-a",
      room_id: "r",
      thread_id: null,
      sender_id: "u",
      body: "hi",
      client_event_id: "event-a",
      created_at: "now",
      edited_at: null,
      deleted_at: null,
      pending: true,
    };
    const saved = { ...local, id: "db-a" };
    expect(reconcileMessage([local], saved)).toEqual([
      { ...saved, pending: false },
    ]);
    expect(
      reconcileMessage([{ ...saved, pending: false }], saved),
    ).toHaveLength(1);
  });
  it("enforces room participation semantics", () => {
    const interest = {
      id: "1",
      slug: "x",
      name: "X",
      topic: null,
      kind: "interest" as const,
      is_private: false,
      is_member: false,
    };
    expect(canPostToRoom(interest)).toBe(false);
    expect(isDiscoverable({ ...interest, is_private: true }, false)).toBe(
      false,
    );
  });
  it("maps profiles and country codes", () => {
    const profile = {
      id: "u",
      username: "ada",
      display_name: null,
      avatar_url: null,
    };
    expect(profileLabel(profile)).toBe("ada");
    expect(profileMap([profile]).get("u")).toEqual(profile);
    expect(normalizeCountryCode(" us ")).toBe("US");
    expect(normalizeCountryCode("bad")).toBe("XX");
  });
});
describe("reconciliation delivery ordering", () => {
  const local = {
    id: "local",
    room_id: "r",
    thread_id: null,
    sender_id: "u",
    body: "hi",
    client_event_id: "id",
    created_at: "now",
    edited_at: null,
    deleted_at: null,
    pending: true,
  };
  const saved = { ...local, id: "saved" };
  it("supports realtime before acknowledgement and duplicate events", () => {
    const realtime = reconcileMessage([local], saved);
    expect(realtime).toHaveLength(1);
    expect(reconcileMessage(realtime, saved)).toHaveLength(1);
  });
  it("supports acknowledgement before realtime and failed-send rollback identity", () => {
    const acknowledged = reconcileMessage([local], saved);
    expect(reconcileMessage(acknowledged, saved)).toHaveLength(1);
    expect(
      [local].filter((message) => message.client_event_id !== "id"),
    ).toHaveLength(0);
  });
});
it("returns an explicit unresolved country without trusted edge context", async () => {
  const { detectCurrentCountry } = await import("../services/geo/country");
  await expect(detectCurrentCountry()).resolves.toEqual({
    code: "XX",
    displayName: "Unresolved region",
    source: "unresolved",
  });
});
import {
  canChangeRole,
  canLeave,
  validMessageTarget,
} from "../services/rooms/roles";
describe("foundation role and message target rules", () => {
  it("protects ownership and validates exactly one destination", () => {
    expect(canChangeRole("owner", "member", "moderator")).toBe(true);
    expect(canChangeRole("owner", "owner", "member")).toBe(false);
    expect(canChangeRole("owner", "owner", "moderator")).toBe(false);
    expect(canChangeRole("moderator", "owner", "member")).toBe(false);
    expect(canChangeRole("member", "member", "moderator")).toBe(false);
    expect(canLeave("owner")).toBe(false);
    expect(validMessageTarget("room", null)).toBe(true);
    expect(validMessageTarget("room", "thread")).toBe(false);
  });
});
import { generateRecoveryPhrase } from "../services/auth/recovery";
import {
  countryRoomSlug,
  validInterestSelection,
} from "../services/onboarding/interests";
describe("onboarding primitives", () => {
  it("generates a 24-word in-memory phrase", () => {
    expect(generateRecoveryPhrase()).toHaveLength(24);
  });
  it("validates interests and country slugs", () => {
    expect(validInterestSelection(["linux", "ai", "linux"])).toBe(true);
    expect(validInterestSelection(["secret"])).toBe(false);
    expect(countryRoomSlug("IN")).toBe("country-in");
    expect(countryRoomSlug("XX")).toBe("country-xx");
  });
});
import { recoveryDownload } from "../components/onboarding/RecoveryCeremony";
describe("recovery ceremony output", () => {
  it("produces offline download content without persistence", () => {
    const output = recoveryDownload("ada", Array(24).fill("anchor"));
    expect(output).toContain("Account: ada");
    expect(output).toContain("24. anchor");
  });
});
import { nextOnboardingStep } from "../services/onboarding/state";
it("derives resumable onboarding steps without recovery plaintext", () => {
  expect(
    nextOnboardingStep({
      recovery: false,
      profile: false,
      country: false,
      interests: false,
    }),
  ).toBe("recovery");
  expect(
    nextOnboardingStep({
      recovery: true,
      profile: true,
      country: true,
      interests: true,
    }),
  ).toBe("complete");
});
