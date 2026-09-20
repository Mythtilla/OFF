import { supabase } from "../../integrations/supabase/client";
import { canonicalizeUsername } from "../auth/username";
import type { ProfileDraft, UpdateProfilePayload } from "./save";

export type MentionMatch = {
  id: string;
  username: string;
  display_name: string | null;
};

export type PublicProfile = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  bio_mentions: MentionMatch[];
  pronouns: string[];
  profile_status: string | null;
  featured_song: { title: string; artist: string } | null;
  interests: string[];
  links: { label: string; url: string }[];
  discoverable: boolean;
  contactable: boolean;
  mention_visibility: "nobody" | "connections" | "everyone";
  viewer_is_owner: boolean;
  viewer_connected: boolean;
  can_message: boolean;
  age?: number;
  location?: string;
};

export type PublicProfileResult = PublicProfile | null;

export type MyProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  discoverable: boolean;
  contactable: boolean;
  mention_visibility: "nobody" | "connections" | "everyone";
  bio_mentions: string[];
  pronouns: string[];
  profile_status: string | null;
  featured_song: { title: string; artist: string } | null;
};

export type MyPrivateRow = {
  profile_id: string;
  real_name: string | null;
  date_of_birth: string | null;
  location_text: string | null;
  personal_visibility: "only_me" | "connections" | "everyone";
  location_visibility: "only_me" | "connections" | "everyone";
};

export type MyProfile = {
  public: MyProfileRow;
  private: MyPrivateRow | null;
  links: MyProfileLink[];
  resolvedMentions: MentionMatch[];
};

export type UserSearchResult = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type MyProfileLink = {
  id: string;
  label: string;
  url: string;
  visibility: "only_me" | "connections" | "everyone";
};

export async function loadPublicProfile(username: string): Promise<PublicProfileResult> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_profile", {
    p_username: canonicalizeUsername(username),
  });
  if (error) return null;
  return (data ?? null) as PublicProfileResult;
}

export async function loadMyProfile(userId: string): Promise<MyProfile | null> {
  if (!supabase) return null;
  const profilesPromise = supabase
    .from("profiles")
    .select(
      "id,username,display_name,avatar_url,bio,discoverable,contactable,mention_visibility,bio_mentions,pronouns,profile_status,featured_song",
    )
    .eq("id", userId)
    .single();
  const [profiles, privateRow, links, selfView] = await Promise.all([
    profilesPromise,
    supabase.from("profile_private").select("*").eq("profile_id", userId).maybeSingle(),
    supabase.from("profile_links").select("id,label,url,visibility").eq("profile_id", userId),
    profilesPromise.then(({ data }) =>
      data?.username ? loadPublicProfile(data.username) : Promise.resolve(null),
    ),
  ]);
  if (profiles.error || !profiles.data) return null;
  if ((privateRow as { error?: unknown }).error || (links as { error?: unknown }).error) return null;
  return {
    public: profiles.data as MyProfileRow,
    private: (privateRow as { data?: MyPrivateRow | null }).data ?? null,
    links: (links as { data?: MyProfileLink[] }).data ?? [],
    resolvedMentions: selfView?.bio_mentions ?? [],
  };
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("search_users", { p_query: query, p_limit: 10 });
  if (error) return [];
  return (data ?? []) as UserSearchResult[];
}

export async function updateMyProfile(
  payload: UpdateProfilePayload,
): Promise<PublicProfileResult> {
  if (!supabase) throw new Error("OFF is not configured.");
  const { data, error } = await supabase.rpc("update_my_profile", { p_payload: payload });
  if (error) {
    throw new Error(friendlyProfileError(error.message));
  }
  return (data ?? null) as PublicProfileResult;
}

function friendlyProfileError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("username is taken")) return "That username is already taken.";
  if (lower.includes("mention")) return "Couldn't save. Check the people mentioned.";
  if (lower.includes("link")) return "Couldn't save. Check the links.";
  if (lower.includes("payload")) return "Couldn't save your profile.";
  if (lower.includes("range check") || lower.includes("new row violates")) {
    return "Couldn't save. Something you entered is too long.";
  }
  if (lower.includes("date")) return "Couldn't save. Check the date.";
  return "Couldn't save your profile. Try again.";
}

/** Builds the editor's baseline draft from the owner-loadable rows. */
export function draftFromMyProfile(my: MyProfile): ProfileDraft {
  const priv = my.private;
  const bio = my.public.bio ?? "";
  const byUsername = new Map(my.resolvedMentions.map((m) => [m.username.toLowerCase(), m]));
  const seen = new Set<string>();
  const mentionRefs: { username: string; id: string }[] = [];
  for (const match of bio.matchAll(/@([a-zA-Z0-9_]{3,32})(?![a-zA-Z0-9_])/g)) {
    const entry = byUsername.get(match[1].toLowerCase());
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      mentionRefs.push({ username: entry.username, id: entry.id });
    }
  }
  return {
    displayName: my.public.display_name ?? "",
    username: my.public.username,
    bio,
    mentionRefs,
    pronouns: my.public.pronouns ?? [],
    profileStatus: my.public.profile_status ?? "",
    featuredSong: my.public.featured_song,
    links: my.links.map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      visibility: link.visibility,
    })),
    realName: priv?.real_name ?? "",
    dateOfBirth: priv?.date_of_birth ?? "",
    locationText: priv?.location_text ?? "",
    discoverable: my.public.discoverable,
    contactable: my.public.contactable,
    mentionVisibility: my.public.mention_visibility,
    personalVisibility: priv?.personal_visibility ?? "only_me",
    locationVisibility: priv?.location_visibility ?? "only_me",
    avatarUrl: my.public.avatar_url ?? "",
  };
}