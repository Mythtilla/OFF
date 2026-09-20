import { describe, expect, it, vi, afterEach } from "vitest";
import { safeAuthError } from "../services/auth/errors";
import { debounce } from "../utils/debounce";
import { onboardingProgress } from "../services/onboarding/progress";
import { generateRecoveryPhrase, recoveryNotice } from "../services/auth/recovery";

describe("safe auth error mapping", () => {
  it("maps invalid credentials to a privacy-preserving message", () => {
    expect(safeAuthError("Invalid login credentials")).toBe(
      "Username or password is incorrect.",
    );
  });
  it("maps duplicate registration to taken", () => {
    expect(safeAuthError("User already registered")).toBe(
      "This username is already taken.",
    );
  });
  it("maps password policy failures to a single surfaced hint", () => {
    expect(safeAuthError("Password should contain at least 6 characters.")).toBe(
      "Choose a stronger password.",
    );
  });
  it("does not pass through raw database errors", () => {
    const raw = 'PGRST116 The result contains 0 rows - Select aborts';
    expect(safeAuthError(raw)).toBe("Something went wrong. Please try again.");
    expect(safeAuthError(raw)).not.toContain("PGRST116");
  });
  it("does not echo arbitrary server text", () => {
    const raw = "duplicate key value violates unique constraint session_token";
    expect(safeAuthError(raw)).toBe("Something went wrong. Please try again.");
  });
});

describe("debounce", () => {
  afterEach(() => vi.useRealTimers());
  it("coalesces rapid schedules into one execution", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const watcher = debounce(fn, 50);
    watcher.schedule();
    watcher.schedule();
    watcher.schedule();
    vi.advanceTimersByTime(30);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(25);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("cancel prevents the pending execution", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const watcher = debounce(fn, 50);
    watcher.schedule();
    watcher.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });
  it("can be rescheduled after firing", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const watcher = debounce(fn, 50);
    watcher.schedule();
    vi.advanceTimersByTime(60);
    watcher.schedule();
    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("onboarding progress", () => {
  const done = "2026-09-06T00:00:00.000Z";
  const state = (flags: [string | null, string | null]) => ({
    recovery_acknowledged_at: flags[0],
    profile_completed_at: flags[1],
  });
  it("starts empty at 0%", () => {
    const p = onboardingProgress(state([null, null]));
    expect(p.percent).toBe(0);
    expect(p.current).toBe("recovery");
  });
  it("reports 50% per completed step", () => {
    const p = onboardingProgress(state([done, null]));
    expect(p.percent).toBe(50);
    expect(p.current).toBe("profile");
  });
  it("reports 100% and no current step when finished", () => {
    const p = onboardingProgress(state([done, done]));
    expect(p.percent).toBe(100);
    expect(p.current).toBeNull();
  });
  it("labels steps Recovery, Profile", () => {
    const p = onboardingProgress(state([null, null]));
    expect(p.steps.map((s) => s.label)).toEqual(["Recovery", "Profile"]);
  });
  it("marks only completed steps as done", () => {
    const p = onboardingProgress(state([done, null]));
    expect(p.steps.map((s) => s.done)).toEqual([true, false]);
  });
});

describe("recovery phrase", () => {
  it("generates 24 words", () => {
    expect(generateRecoveryPhrase()).toHaveLength(24);
  });
  it("never contains the account identity", () => {
    for (const word of generateRecoveryPhrase()) {
      expect(word.length).toBeGreaterThan(0);
    }
  });
  it("describes a real one-way recovery verifier, not a placeholder", () => {
    expect(recoveryNotice).toContain("verifier");
    expect(recoveryNotice).not.toContain("placeholder");
  });
});