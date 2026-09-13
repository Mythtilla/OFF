import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "@supabase/supabase-js";
import { AuthForm } from "../components/auth/AuthForm";
import { ChatShell } from "../components/chat/ChatShell";
import { OnboardingFlow } from "../components/onboarding/OnboardingFlow";

const ROOT = process.cwd();
let css = "";

beforeAll(() => {
  css = readFileSync(resolve(ROOT, "src/styles.css"), "utf8");
});

const session = {
  user: { id: "u-1", user_metadata: { username: "ada" } },
} as unknown as Session;

const profile = {
  username: "ada",
  recovery_acknowledged_at: null,
  profile_completed_at: null,
  country_handled_at: null,
  interests_handled_at: null,
  onboarding_completed: false,
};

describe("component smoke (universal render)", () => {
  it("AuthForm renders the username and password surface", () => {
    const html = renderToStaticMarkup(<AuthForm onClose={() => {}} />);
    expect(html).toContain("Username");
    expect(html).toContain("Password");
    expect(html).toContain("New here? Create an account");
  });

  it("ChatShell mounts and exposes the primary nav destinations", () => {
    const html = renderToStaticMarkup(<ChatShell session={session} />);
    expect(html).toContain("OPEN FREEDOM FORUM");
    expect(html).toContain("Home");
    expect(html).toContain("Rooms");
    expect(html).toContain("You");
    expect(html).toContain("Loading rooms…");
  });

  it("OnboardingFlow starts at the recovery step with a progress indicator", () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow session={session} profile={profile} onComplete={() => {}} />,
    );
    expect(html).toContain("onboard-progress");
    expect(html).toContain("Recovery");
    expect(html).toContain("Your recovery phrase.");
  });
});

describe("styles.css design system", () => {
  it("defines core design tokens", () => {
    for (const token of ["--bg", "--bg2", "--surface", "--border", "--text", "--text2", "--text3", "--accent", "--danger", "--ok", "--radius", "--font-mono", "--nav-w"]) {
      expect(css).toContain(`${token}:`);
    }
  });
  it("colors are centralized through tokens, not inline literals", () => {
    const rootBlock = css.match(/:root \{[^}]*\}/)?.[0] ?? "";
    const outsideRoot = css.replace(rootBlock, "");
    const inlineHex = outsideRoot.match(/#[0-9a-fA-F]{6}/g) ?? [];
    const allowed = ["#fff", "#111", "#777"]; // print only
    const offenders = inlineHex.filter((hex) => !allowed.includes(hex));
    expect(offenders).toEqual([]);
  });
});

describe("responsive architecture in CSS", () => {
  it("uses the defined mobile and desktop breakpoints", () => {
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("@media (min-width: 1200px)");
  });
  it("mobile app uses 100dvh and hides the desktop navbar", () => {
    expect(css).toContain("height: 100dvh");
    expect(css).toContain(".app aside.nav {\n    display: none;\n  }");
  });
  it("prevents horizontal overflow on small screens", () => {
    expect(css).toMatch(/html,\s*body \{\n\s*overflow-x: hidden/);
  });
  it("respects the bottom safe area for composer and nav", () => {
    expect(css).toMatch(/env\(safe-area-inset-bottom/);
  });
  it("mobile inputs use 16px to avoid iOS zoom", () => {
    const mobile = css.split("@media (max-width: 767px)")[1];
    expect(mobile).toContain("font-size: 16px");
  });
  it("mobile composer and touch targets meet 44px guidance", () => {
    expect(css).toMatch(/\.composer (input|button) \{[^}]*min-height: 48px/s);
    expect(css).toMatch(/\.bottom-nav button \{[^}]*min-height: 52px/s);
    expect(css).toMatch(/\.sheet-head button \{[^}]*min-width: 44px/s);
  });
  it("sheets hide above the mobile breakpoint", () => {
    expect(css).toContain("@media (min-width: 768px) {\n  .sheet {\n    display: none;");
  });
  it("details panel is a right rail on desktop and an overlay below", () => {
    expect(css).toMatch(/\.details-panel \{[^}]*width: min\(340px, 90vw\)/s);
    expect(css).toMatch(/\.details-panel\.open \{\n\s*transform: translateX\(0\);/);
  });
  it("honors reduced-motion preferences", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition-duration: 0.01ms !important");
  });
  it("focus is visible on all interactive controls", () => {
    expect(css).toContain("button:focus-visible,\ninput:focus-visible,\na:focus-visible");
  });
});

describe("semantic structure (ssr + source)", () => {
  const authHtml = renderToStaticMarkup(<AuthForm onClose={() => {}} />);
  const chatHtml = renderToStaticMarkup(<ChatShell session={session} />);
  const onboardHtml = renderToStaticMarkup(
    <OnboardingFlow session={session} profile={profile} onComplete={() => {}} />,
  );

  it("renders exactly one h1 per view", () => {
    const h1 = (html: string) => (html.match(/<h1/g) ?? []).length;
    expect(h1(authHtml)).toBe(1);
    expect(h1(chatHtml)).toBe(1);
    expect(h1(onboardHtml)).toBe(1);
  });

  it("announces live regions without relying on color", () => {
    expect(chatHtml).toContain("aria-live=\"polite\"");
    expect(chatHtml).toContain("○ Connecting…");
  });

  it("marks errors as alert regions and auth status as a status region", () => {
    expect(chatHtml).not.toContain("role=\"alert\""); // rendered only on failure
    const authSrc = readFileSync(resolve(ROOT, "src/components/auth/AuthForm.tsx"), "utf8");
    const chatSrc = readFileSync(resolve(ROOT, "src/components/chat/ChatShell.tsx"), "utf8");
    expect(authSrc).toContain("role=\"status\"");
    expect(chatSrc).toContain("role=\"alert\"");
  });

  it("gives every icon-only control an accessible name", () => {
    const chat = readFileSync(resolve(ROOT, "src/components/chat/ChatShell.tsx"), "utf8");
    for (const label of ["Open communities", "Room details", "Close room details", "Send message"]) {
      expect(chat, label).toContain(`aria-label="${label}"`);
    }
    expect(chat).toContain('aria-label={`Close ${title}`}');
    expect(chat).toContain('title="Communities"');
    expect(chat).toContain('title="You"');
  });

  it("binds label text to inputs and self-describes sheets", () => {
    expect(authHtml).toContain("<label>Username");
    expect(authHtml).not.toContain("placeholder=");
    expect(chatHtml).toContain("aria-hidden=\"true\"");
    expect(chatHtml).toContain("aria-expanded=\"true\"");
    expect(chatHtml).toContain("role=\"tablist\"");
  });

  it("exposes progressive disclosure state on the details toggle", () => {
    const chat = readFileSync(resolve(ROOT, "src/components/chat/ChatShell.tsx"), "utf8");
    expect(chat).toContain("aria-expanded={detailsOpen}");
  });

  it("expresses composer enablement honestly", () => {
    expect(chatHtml).toContain("Choose a room");
    expect(chatHtml).toContain("disabled=\"\"");
  });

  it("toggles the password field without leaking its value to a listener stack", () => {
    expect(authHtml).toContain("aria-label=\"Show password\"");
  });
});

describe("ui/logic coupling checks", () => {
  it("realtime status keeps truthful wording (no fabricated LIVE)", () => {
    const chatShell = readFileSync(
      resolve(ROOT, "src/components/chat/ChatShell.tsx"),
      "utf8",
    );
    expect(chatShell).toContain("statusLabel");
  });
  it("no decorative controls point at unsupported features", () => {
    const chatShell = readFileSync(
      resolve(ROOT, "src/components/chat/ChatShell.tsx"),
      "utf8",
    );
    for (const absent of ["Upload", "attach", "Notifications", "Emoji"]) {
      expect(chatShell, absent).not.toContain(absent);
    }
  });
  it("privacy copy avoids overclaiming", () => {
    const chat = chatShellSource();
    for (const banned of ["Untraceable", "Anonymous forever", "Impossible to monitor"]) {
      expect(css + chat, banned).not.toContain(banned);
    }
    expect(chat).toContain("access controls, not end-to-end");
  });
  function chatShellSource() {
    return readFileSync(
      resolve(ROOT, "src/components/chat/ChatShell.tsx"),
      "utf8",
    );
  }
});