import { describe, expect, it } from "vitest";
import {
  buildBioSegments,
  tokenizeMentions,
  type MentionEntry,
} from "../services/profile/mentions";
import {
  normalizeLinkUrl,
  validateLinkUrl,
  visibleLinks,
} from "../services/profile/links";
import {
  INITIAL_SAVE_STATE,
  buildUpdatePayload,
  draftDirty,
  normalizePronouns,
  saveButtonLabel,
  saveStateReducer,
  validateDraft,
  type ProfileDraft,
  type SaveState,
} from "../services/profile/save";
import {
  draftFromMyProfile,
  type MyProfile,
} from "../services/profile/profile";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  PROFILE_TABS,
  SwitchRow,
  VisibilitySegmented,
  visibilityOptionLabel,
} from "../components/chat/ProfileSettings";

const mentions: MentionEntry[] = [
  { id: "u1", username: "alex", displayName: "Alex" },
  { id: "u2", username: "mira", displayName: "Mira" },
];

describe("tokenizeMentions", () => {
  it("extracts lowercase usernames from @tokens", () => {
    expect(tokenizeMentions("hi @Alex and @mira!")).toEqual(["alex", "mira"]);
  });
  it("returns empty array for plain text", () => {
    expect(tokenizeMentions("no tokens here")).toEqual([]);
  });
  it("excludes tokens without the authenticated shape", () => {
    expect(tokenizeMentions("hi @a @longer_than_32_characters_username_here and x@y")).toEqual([]);
  });
});

describe("buildBioSegments", () => {
  it("renders known mentions as linkable segments", () => {
    const segments = buildBioSegments("Talk to @Alex about it.", mentions, new Set());
    expect(segments).toEqual([
      { kind: "text", text: "Talk to " },
      { kind: "mention", token: "@Alex", username: "alex", id: "u1" },
      { kind: "text", text: " about it." },
    ]);
  });
  it("renders an unknown @token as plain text", () => {
    const segments = buildBioSegments("hi @stranger", mentions, new Set());
    expect(segments).toEqual([
      { kind: "text", text: "hi " },
      { kind: "text", text: "@stranger" },
    ]);
  });
  it("renders a blocked account's mention as plain text", () => {
    const segments = buildBioSegments("hi @mira", mentions, new Set(["u2"]));
    expect(segments).toEqual([
      { kind: "text", text: "hi " },
      { kind: "text", text: "@mira" },
    ]);
  });
  it("handles empty text and a bare mention", () => {
    expect(buildBioSegments("", mentions, new Set())).toEqual([]);
    expect(buildBioSegments("@alex", mentions, new Set())).toEqual([
      { kind: "mention", token: "@alex", username: "alex", id: "u1" },
    ]);
  });
});

describe("normalizeLinkUrl", () => {
  it("accepts http and https with whitespace trimmed", () => {
    expect(normalizeLinkUrl("  https://example.com/a  ")).toBe("https://example.com/a");
    expect(normalizeLinkUrl("http://example.com")).toBe("http://example.com");
  });
  it("rejects missing schemes and javascript: URLs", () => {
    expect(normalizeLinkUrl("example.com")).toBeNull();
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("ftp://example.com")).toBeNull();
  });
  it("rejects empty and oversized inputs", () => {
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("https://example.com/" + "a".repeat(2048))).toBeNull();
  });
});

describe("validateLinkUrl", () => {
  it("allows a full URL and flags anything else", () => {
    expect(validateLinkUrl("https://example.com")).toBeNull();
    expect(validateLinkUrl("example.com")).toBeTruthy();
    expect(validateLinkUrl("")).toBeNull();
  });
});

describe("visibleLinks", () => {
  const links = [
    { label: "Site", url: "https://a.example", visibility: "everyone" as const },
    { label: "Work", url: "https://b.example", visibility: "connections" as const },
    { label: "Draft", url: "https://c.example", visibility: "only_me" as const },
  ];
  it("shows everything to the owner", () => {
    expect(visibleLinks(links, { self: true, connected: false }).map((l) => l.label)).toEqual([
      "Draft",
      "Site",
      "Work",
    ]);
  });
  it("shows everyone-links to an unconnected viewer", () => {
    expect(visibleLinks(links, { self: false, connected: false }).map((l) => l.label)).toEqual([
      "Site",
    ]);
  });
  it("adds connection-gated links for connected viewers", () => {
    expect(visibleLinks(links, { self: false, connected: true }).map((l) => l.label)).toEqual([
      "Site",
      "Work",
    ]);
  });
  it("sorts labels case-insensitively", () => {
    expect(
      visibleLinks(
        [
          { label: "zeta", url: "https://z.example", visibility: "everyone" },
          { label: "Alpha", url: "https://a.example", visibility: "everyone" },
        ],
        { self: false, connected: false },
      ).map((l) => l.label),
    ).toEqual(["Alpha", "zeta"]);
  });
});

describe("normalizePronouns", () => {
  it("splits, trims, lowercases and dedupes", () => {
    expect(normalizePronouns("she/her, They/Them , she/her")).toEqual(["she/her", "they/them"]);
  });
  it("caps at 12 and drops empties", () => {
    expect(normalizePronouns(", , a,b,c,d,e,f,g,h,i,j,k,l,m,n,")).toHaveLength(12);
  });
});

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  displayName: "Alex",
  username: "alex",
  bio: "",
  mentionRefs: [],
  pronouns: [],
  profileStatus: "",
  featuredSong: null,
  links: [],
  realName: "",
  dateOfBirth: "",
  locationText: "",
  discoverable: false,
  contactable: false,
  mentionVisibility: "everyone",
  personalVisibility: "only_me",
  locationVisibility: "only_me",
  avatarUrl: "",
  ...overrides,
});

describe("saveStateReducer", () => {
  it("walks dirty → saving → saved", () => {
    let s: SaveState = INITIAL_SAVE_STATE;
    expect(s.status).toBe("pristine");
    s = saveStateReducer(s, { type: "touch" });
    expect(s.status).toBe("dirty");
    s = saveStateReducer(s, { type: "saving" });
    expect(s.status).toBe("saving");
    s = saveStateReducer(s, { type: "saved" });
    expect(s.status).toBe("saved");
  });
  it("locks out touch while saving and captures errors", () => {
    expect(saveStateReducer({ status: "saving" }, { type: "touch" }).status).toBe("saving");
    const errored = saveStateReducer(INITIAL_SAVE_STATE, {
      type: "error",
      message: "Couldn't save.",
    });
    expect(errored).toEqual({ status: "error", message: "Couldn't save." });
    expect(saveButtonLabel(errored)).toBe("Save changes");
  });
  it("labels each state honestly", () => {
    expect(saveButtonLabel({ status: "pristine" })).toBe("Done");
    expect(saveButtonLabel({ status: "dirty" })).toBe("Save changes");
    expect(saveButtonLabel({ status: "saving" })).toBe("Saving…");
    expect(saveButtonLabel({ status: "saved" })).toBe("Saved");
  });
});

describe("validateDraft", () => {
  it("accepts a clean draft", () => {
    expect(validateDraft(draft())).toEqual({});
  });
  it("rejects an empty or malformed username", () => {
    expect(validateDraft(draft({ username: "" })).username).toBeTruthy();
    expect(validateDraft(draft({ username: "Bad Username!" })).username).toBeTruthy();
  });
  it("rejects overlong display name, bio, status and location", () => {
    expect(validateDraft(draft({ displayName: "a".repeat(81) })).displayName).toBeTruthy();
    expect(validateDraft(draft({ bio: "b".repeat(501) })).bio).toBeTruthy();
    expect(validateDraft(draft({ profileStatus: "s".repeat(81) })).profileStatus).toBeTruthy();
    expect(validateDraft(draft({ locationText: "l".repeat(81) })).locationText).toBeTruthy();
  });
  it("rejects invalid pronouns, song, name and date", () => {
    expect(validateDraft(draft({ pronouns: ["sad---thing"] })).pronouns).toBeTruthy();
    expect(validateDraft(draft({ featuredSong: { title: "", artist: "" } })).featuredSong).toBeTruthy();
    expect(validateDraft(draft({ featuredSong: { title: "x".repeat(81), artist: "y" } })).featuredSong).toBeTruthy();
    expect(validateDraft(draft({ realName: "n".repeat(81) })).realName).toBeTruthy();
    expect(validateDraft(draft({ dateOfBirth: "not-a-date" })).dateOfBirth).toBeTruthy();
  });
  it("rejects empty labels and bad URLs per link", () => {
    const bad = validateDraft(draft({ links: [{ id: "l1", label: "", url: "example.com", visibility: "everyone" }] }));
    expect(bad["link:l1"]).toBeTruthy();
    const badUrl = validateDraft(draft({ links: [{ id: "l2", label: "ok", url: "no-scheme", visibility: "everyone" }] }));
    expect(badUrl["link:l2"]).toBeTruthy();
  });
});

describe("buildUpdatePayload", () => {
  const base = draft();
  it("omits username when unchanged", () => {
    expect("username" in buildUpdatePayload(base, draft())).toBe(false);
  });
  it("includes a canonicalized username only when changed", () => {
    expect(buildUpdatePayload(base, draft({ username: "A L E X" })).username).toBe("a l e x");
  });
  it("derives bio_mentions from refs still present in the bio", () => {
    const changed = draft({
      bio: "ping @alex and @stale",
      mentionRefs: [
        { username: "alex", id: "u1" },
        { username: "gone", id: "u9" },
      ],
    });
    expect(buildUpdatePayload(base, changed).bio_mentions).toEqual(["u1"]);
  });
  it("drops incomplete songs and invalid links", () => {
    const changed = draft({
      featuredSong: { title: "  ", artist: "" },
      links: [
        { id: "l1", label: "ok", url: "https://example.com", visibility: "connections" },
        { id: "l2", label: "bad", url: "nope", visibility: "everyone" },
      ],
    });
    const payload = buildUpdatePayload(base, changed);
    expect(payload.featured_song).toBeNull();
    expect(payload.links).toEqual([
      { label: "ok", url: "https://example.com", visibility: "connections" },
    ]);
  });
  it("emits the private block with visibility defaults", () => {
    const payload = buildUpdatePayload(base, draft({ realName: "R", locationText: "AT" }));
    expect(payload.private).toEqual({
      real_name: "R",
      date_of_birth: null,
      location_text: "AT",
      personal_visibility: "only_me",
      location_visibility: "only_me",
    });
  });
  it("open profile fields ship real values", () => {
    const payload = buildUpdatePayload(base, draft({ displayName: "Mira", discoverable: true }));
    expect(payload.display_name).toBe("Mira");
    expect(payload.discoverable).toBe(true);
  });
});

describe("draftDirty", () => {
  it("reports true only on meaningful changes", () => {
    const base = draft({ bio: "hello" });
    expect(draftDirty(base, draft({ bio: "hello" }))).toBe(false);
    expect(draftDirty(base, draft())).toBe(true);
    expect(draftDirty(base, draft({ bio: "hello!", pronouns: ["they/them"] }))).toBe(true);
  });
});

describe("draftFromMyProfile", () => {
  const myProfile: MyProfile = {
    public: {
      id: "me",
      username: "alex",
      display_name: "Alex",
      avatar_url: null,
      bio: "Say hi to @Mira and @mira.",
      discoverable: true,
      contactable: true,
      mention_visibility: "everyone",
      bio_mentions: ["u1", "u2", "u9"],
      pronouns: ["she/her"],
      profile_status: "building",
      featured_song: null,
    },
    private: {
      profile_id: "me",
      real_name: "Alex R",
      date_of_birth: "1995-01-01",
      location_text: "Lisbon",
      personal_visibility: "only_me",
      location_visibility: "everyone",
    },
    links: [
      { id: "l1", label: "Blog", url: "https://example.com", visibility: "everyone" },
    ],
    resolvedMentions: [
      { id: "u1", username: "mira", display_name: "Mira" },
      { id: "u2", username: "mira", display_name: "Mira" },
      { id: "u9", username: "ghost", display_name: "Ghost" },
    ],
  };

  it("resolves bio_mention ids to usernames for tokens present in the bio", () => {
    const d = draftFromMyProfile(myProfile);
    expect(d.mentionRefs).toEqual([{ username: "mira", id: "u2" }]);
    expect(d.bio).toContain("@mira");
  });
  it("drops references whose @token is no longer in the bio", () => {
    const d = draftFromMyProfile(myProfile);
    expect(d.mentionRefs.some((r) => r.username === "ghost")).toBe(false);
  });
  it("carries private, links, and visibility defaults into the draft", () => {
    const d = draftFromMyProfile(myProfile);
    expect(d.realName).toBe("Alex R");
    expect(d.locationVisibility).toBe("everyone");
    expect(d.links).toEqual([
      { id: "l1", label: "Blog", url: "https://example.com", visibility: "everyone" },
    ]);
  });
});

describe("PROFILE_TABS", () => {
  it("orders the four edit sections as decided", () => {
    expect(PROFILE_TABS.map((t) => t.id)).toEqual([
      "profile",
      "links",
      "personal",
      "privacy",
    ]);
  });
});

describe("visibilityOptionLabel", () => {
  it("maps raw options to friendly labels", () => {
    expect(visibilityOptionLabel("nobody")).toBe("No one");
    expect(visibilityOptionLabel("only_me")).toBe("Only me");
    expect(visibilityOptionLabel("connections")).toBe("Connections");
    expect(visibilityOptionLabel("everyone")).toBe("Everyone");
  });
  it("returns unknown values untouched", () => {
    expect(visibilityOptionLabel("staff")).toBe("staff");
  });
});

describe("VisibilitySegmented", () => {
  const props = {
    label: "Who can see it",
    value: "connections" as const,
    options: ["only_me", "connections", "everyone"] as const,
    onChange: () => {},
  };
  it("renders a radiogroup with one active radio", () => {
    const html = renderToStaticMarkup(
      createElement(VisibilitySegmented, { ...props, onChange: () => {} }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Who can see it"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('class="active"');
    expect(html).toContain("Connections");
    expect(html).toContain("Only me");
  });
});

describe("SwitchRow", () => {
  it("renders a switch input checked per state", () => {
    const on = renderToStaticMarkup(
      createElement(SwitchRow, {
        label: "Public profile",
        description: "Anyone can view.",
        checked: true,
        onChange: () => {},
      }),
    );
    const off = renderToStaticMarkup(
      createElement(SwitchRow, {
        label: "Public profile",
        checked: false,
        onChange: () => {},
      }),
    );
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('role="switch"');
    expect(on).toContain('checked=""');
    expect(on).toContain("Public profile");
    expect(on).toContain("Anyone can view.");
    expect(off).not.toContain('checked=""');
  });
});