import { canonicalizeUsername, usernamePattern } from "../auth/username";
import { normalizeLinkUrl, validateLinkUrl, type LinkVisibility } from "./links";

export type VisibleTo = LinkVisibility;
export type MentionVisibility = VisibleTo | "nobody";

export const VISIBLE_TO_OPTIONS: VisibleTo[] = ["only_me", "connections", "everyone"];
export const MENTION_VISIBILITY_OPTIONS: MentionVisibility[] = [
  "nobody",
  "connections",
  "everyone",
];
export const DEFAULT_MENTION_VISIBILITY: MentionVisibility = "everyone";
export const DEFAULT_VISIBLE_TO: VisibleTo = "only_me";

export type MentionRef = { username: string; id: string };
export type FeaturedSong = { title: string; artist: string };
export type DraftLink = { id: string; label: string; url: string; visibility: LinkVisibility };

export type ProfileDraft = {
  displayName: string;
  username: string;
  bio: string;
  mentionRefs: MentionRef[];
  pronouns: string[];
  profileStatus: string;
  featuredSong: FeaturedSong | null;
  links: DraftLink[];
  realName: string;
  dateOfBirth: string;
  locationText: string;
  discoverable: boolean;
  contactable: boolean;
  mentionVisibility: MentionVisibility;
  personalVisibility: VisibleTo;
  locationVisibility: VisibleTo;
  avatarUrl: string;
};

export type ProfilePrivatePayload = {
  real_name?: string | null;
  date_of_birth?: string | null;
  location_text?: string | null;
  personal_visibility?: VisibleTo;
  location_visibility?: VisibleTo;
};

export type UpdateProfilePayload = {
  display_name: string | null;
  username?: string;
  bio: string | null;
  bio_mentions: string[];
  pronouns: string[];
  profile_status: string | null;
  featured_song: FeaturedSong | null;
  discoverable: boolean;
  contactable: boolean;
  mention_visibility: MentionVisibility;
  avatar_url: string | null;
  links: { label: string; url: string; visibility: LinkVisibility }[];
  private: ProfilePrivatePayload;
};

export type SaveState =
  | { status: "pristine" }
  | { status: "dirty" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export type SaveAction =
  | { type: "touch" }
  | { type: "saving" }
  | { type: "saved" }
  | { type: "error"; message: string }
  | { type: "reset" };

export const INITIAL_SAVE_STATE: SaveState = { status: "pristine" };

export function saveStateReducer(state: SaveState, action: SaveAction): SaveState {
  switch (action.type) {
    case "touch":
      return state.status === "saving" || state.status === "error" ? state : { status: "dirty" };
    case "saving":
      return { status: "saving" };
    case "saved":
      return { status: "saved" };
    case "error":
      return { status: "error", message: action.message };
    case "reset":
      return { status: "pristine" };
  }
}

export function saveButtonLabel(state: SaveState): string {
  switch (state.status) {
    case "pristine":
      return "Done";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "dirty":
    case "error":
      return "Save changes";
  }
}

export function saveStateMessage(state: SaveState): string | null {
  return state.status === "error" ? state.message : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizePronouns(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

type DraftErrors = Partial<
  Record<
    | "displayName"
    | "username"
    | "bio"
    | "pronouns"
    | "profileStatus"
    | "featuredSong"
    | "realName"
    | "dateOfBirth"
    | "locationText",
    string
  >
> & {
  [linkId: string]: string | undefined;
};

export function validateDraft(draft: ProfileDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.displayName.trim().length > 80) {
    errors.displayName = "Display name must be 80 characters or fewer.";
  }
  const normalizedUsername = canonicalizeUsername(draft.username);
  if (!normalizedUsername) {
    errors.username = "Username can't be empty.";
  } else if (!usernamePattern.test(normalizedUsername)) {
    errors.username = "Use 3–32 lowercase letters, numbers, or underscores.";
  }
  if (draft.bio.length > 500) errors.bio = "Bio must be 500 characters or fewer.";
  if (
    draft.pronouns.length > 12 ||
    draft.pronouns.some(
      (p) => p.length > 32 || !/^[a-z][a-z /]*$/i.test(p) || p.includes("  "),
    )
  ) {
    errors.pronouns = "Pronouns use letters and a slash — 32 characters maximum.";
  }
  if (draft.profileStatus.trim().length > 80) {
    errors.profileStatus = "This line must be 80 characters or fewer.";
  }
  if (draft.featuredSong) {
    if (draft.featuredSong.title.length > 80) {
      errors.featuredSong = "Song titles are 80 characters maximum.";
    } else if (draft.featuredSong.artist.length > 120) {
      errors.featuredSong = "Artist names are 120 characters maximum.";
    } else if (!draft.featuredSong.title.trim() && !draft.featuredSong.artist.trim()) {
      errors.featuredSong = "Add a song title and artist — or leave it empty.";
    }
  }
  for (const link of draft.links) {
    const label = link.label.trim();
    if (!label) {
      errors[`link:${link.id}`] = "Add a label for every link.";
    } else if (label.length > 40) {
      errors[`link:${link.id}`] = "Link labels are 40 characters max.";
    } else {
      const urlError = validateLinkUrl(link.url);
      if (urlError) errors[`link:${link.id}`] = urlError;
    }
  }
  if (draft.realName.length > 80) errors.realName = "Real name must be 80 characters or fewer.";
  if (
    draft.dateOfBirth &&
    (!/^(19\d\d|20[0-2]\d)-\d{2}-\d{2}$/.test(draft.dateOfBirth) ||
      Number.isNaN(Date.parse(draft.dateOfBirth)))
  ) {
    errors.dateOfBirth = "Use a valid date in YYYY-MM-DD format.";
  }
  if (draft.locationText.length > 80) {
    errors.locationText = "Location must be 80 characters or fewer.";
  }
  return errors;
}

/**
 * Builds the complete payload for update_my_profile from the draft. The
 * bio_mentions array is derived from mention references whose @token still
 * appears in the final bio, so stale references are dropped automatically.
 */
export function buildUpdatePayload(
  baseline: ProfileDraft,
  draft: ProfileDraft,
): UpdateProfilePayload {
  const canonicalNow = canonicalizeUsername(draft.username);
  const canonicalBase = canonicalizeUsername(baseline.username);
  const payload: UpdateProfilePayload = {
    display_name: draft.displayName.trim() || null,
    bio: draft.bio.trim() || null,
    bio_mentions: Array.from(
      new Set(
        draft.mentionRefs
          .filter((ref) => new RegExp(`@${escapeRegExp(ref.username)}(?![a-z0-9_])`, "i").test(draft.bio))
          .map((ref) => ref.id),
      ),
    ).slice(0, 32),
    pronouns: draft.pronouns,
    profile_status: draft.profileStatus.trim() || null,
    featured_song: draft.featuredSong &&
      (draft.featuredSong.title.trim() || draft.featuredSong.artist.trim())
      ? draft.featuredSong
      : null,
    discoverable: draft.discoverable,
    contactable: draft.contactable,
    mention_visibility: draft.mentionVisibility,
    avatar_url: draft.avatarUrl || null,
    links: draft.links
      .filter((link) => link.label.trim() && normalizeLinkUrl(link.url))
      .map((link) => ({
        label: link.label.trim(),
        url: normalizeLinkUrl(link.url)!,
        visibility: link.visibility,
      }))
      .slice(0, 8),
    private: {
      real_name: draft.realName.trim() || null,
      date_of_birth: draft.dateOfBirth || null,
      location_text: draft.locationText.trim() || null,
      personal_visibility: draft.personalVisibility,
      location_visibility: draft.locationVisibility,
    },
  };
  if (canonicalNow && canonicalNow !== canonicalBase) {
    payload.username = canonicalNow;
  }
  return payload;
}

function signature(base: ProfileDraft, draft: ProfileDraft): string {
  return JSON.stringify(buildUpdatePayload(base, draft));
}

export function draftDirty(base: ProfileDraft, draft: ProfileDraft): boolean {
  return signature(base, draft) !== signature(base, base);
}