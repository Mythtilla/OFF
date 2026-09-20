import { useEffect, useReducer, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "../../services/chat/types";
import {
  canonicalizeUsername,
  validateUsername,
} from "../../services/auth/username";
import { checkUsername } from "../../services/auth/availability";
import {
  draftDirty,
  MENTION_VISIBILITY_OPTIONS,
  VISIBLE_TO_OPTIONS,
  INITIAL_SAVE_STATE,
  normalizePronouns,
  saveButtonLabel,
  saveStateReducer,
  saveStateMessage,
  validateDraft,
  buildUpdatePayload,
  type DraftLink,
  type ProfileDraft,
} from "../../services/profile/save";
import { draftFromMyProfile, loadMyProfile, updateMyProfile } from "../../services/profile/profile";
import { Link } from "../../lib/Link";
import { Avatar } from "./Avatar";
import { MentionTextarea } from "../profile/MentionTextarea";

const AVATAR_SIZE = 256;

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read the image file."));
    reader.readAsDataURL(file);
  });
}

async function downscaleToAvatar(dataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Couldn't load the image file."));
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  ctx.fillStyle = "#11120f";
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const source = Math.min(img.width, img.height);
  const sx = (img.width - source) / 2;
  const sy = (img.height - source) / 2;
  ctx.drawImage(img, sx, sy, source, source, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL("image/jpeg", 0.85);
}

type UsernameHint = { kind: "idle" | "checking" | "available" | "taken" | "invalid" };

export function ProfileSettings({
  session,
  profile,
  onSaved,
}: {
  session: Session;
  profile: Profile;
  onSaved: (updated: Profile) => void;
}) {
  const [baseline, setBaseline] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saveState, dispatch] = useReducer(saveStateReducer, INITIAL_SAVE_STATE);
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [usernameHint, setUsernameHint] = useState<UsernameHint>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setBaseline(null);
    setDraft(null);
    setLoadFailed(false);
    loadMyProfile(session.user.id).then((loaded) => {
      if (cancelled || !loaded) {
        if (!cancelled) setLoadFailed(true);
        return;
      }
      const base = draftFromMyProfile(loaded);
      setBaseline(base);
      setDraft(base);
      dispatch({ type: "reset" });
    });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  function patch(next: Partial<ProfileDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    dispatch({ type: "touch" });
    setError(null);
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await downscaleToAvatar(await readImage(file));
      setAvatarDraft(dataUrl);
      patch({ avatarUrl: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that image.");
    }
  }

  async function onUsernameChange(next: string) {
    patch({ username: next });
    setUsernameHint({ kind: "checking" });
    const canonical = canonicalizeUsername(next);
    if (!canonical) {
      setUsernameHint({ kind: "idle" });
      return;
    }
    const formatError = validateUsername(canonical);
    if (formatError) {
      setUsernameHint({ kind: "invalid" });
      return;
    }
    if (canonical === canonicalizeUsername(baseline?.username ?? "")) {
      setUsernameHint({ kind: "idle" });
      return;
    }
    const result = await checkUsername(canonical);
    setUsernameHint(
      result.status === "available"
        ? { kind: "available" }
        : result.status === "unavailable"
          ? { kind: "taken" }
          : { kind: "idle" },
    );
  }

  async function save() {
    if (!draft || !baseline) return;
    const errors = validateDraft(draft);
    if (Object.keys(errors).length > 0) {
      setError("Fix the highlighted fields before saving.");
      return;
    }
    dispatch({ type: "saving" });
    setError(null);
    try {
      const payload = buildUpdatePayload(baseline, draft);
      await updateMyProfile(payload);
      let base = draft;
      const loaded = await loadMyProfile(session.user.id);
      if (loaded) base = draftFromMyProfile(loaded);
      setBaseline(base);
      setDraft(base);
      setAvatarDraft(null);
      setUsernameHint({ kind: "idle" });
      dispatch({ type: "saved" });
      onSaved({
        id: session.user.id,
        username: base.username,
        display_name: base.displayName.trim() || null,
        avatar_url: base.avatarUrl || null,
        bio: base.bio.trim() || null,
        discoverable: base.discoverable,
        contactable: base.contactable,
      });
      window.setTimeout(() => dispatch({ type: "reset" }), 2000);
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : "Couldn't save. Try again." });
    }
  }

  function close() {
    if (draft && baseline && draftDirty(baseline, draft)) {
      if (!window.confirm("Discard unsaved profile changes?")) return;
    }
    setEditing(false);
    dispatch({ type: "reset" });
    setError(null);
  }

  function addLink() {
    patch({ links: [...(draft?.links ?? []), { id: `n${Date.now()}`, label: "", url: "", visibility: "everyone" }] });
  }

  function updateLink(id: string, change: Partial<DraftLink>) {
    patch({
      links: (draft?.links ?? []).map((link) => (link.id === id ? { ...link, ...change } : link)),
    });
  }

  function removeLink(id: string) {
    patch({ links: (draft?.links ?? []).filter((link) => link.id !== id) });
  }

  function onAddMentionRef(ref: { username: string; id: string }) {
    patch({
      mentionRefs: [
        ...(draft?.mentionRefs ?? []).filter((r) => r.id !== ref.id),
        ref,
      ],
    });
  }

  if (loadFailed) {
    return (
      <div className="profile-settings">
        <p className="note" role="status">
          Couldn't load your profile settings right now.
        </p>
      </div>
    );
  }
  if (!draft || !baseline) {
    return (
      <div className="profile-settings">
        <Avatar name={profile.display_name || profile.username || "?"} url={profile.avatar_url} large />
        <p className="note" role="status">
          Loading profile…
        </p>
      </div>
    );
  }

  const errors = editing ? validateDraft(draft) : {};
  const dirty = draftDirty(baseline, draft);
  const avatarSrc = avatarDraft ?? draft.avatarUrl;
  const isSaving = saveState.status === "saving";
  const savedMsg = saveStateMessage(saveState);
  const userName = draft.displayName || draft.username || "?";

  if (!editing) {
    return (
      <div className="profile-settings">
        <Avatar name={userName} url={avatarSrc} large />
        <p className="view-name">{userName}</p>
        <p className="view-handle">@{canonicalizeUsername(draft.username)}</p>
        {draft.pronouns.length > 0 && (
          <p className="view-pronouns note">{draft.pronouns.join(" / ")}</p>
        )}
        {draft.profileStatus && <p className="view-status note">{draft.profileStatus}</p>}
        <p className="note view-mode-note">
          {draft.bio || "No bio yet — add one so people know what you're about."}
        </p>
        <p className="view-meta note">
          {draft.discoverable
            ? "Your profile is public — anyone can view it."
            : "Your profile is private — only connected people can view it."}
        </p>
        <div className="view-actions">
          <button className="room-join" onClick={() => setEditing(true)} type="button">
            Edit profile
          </button>
          <Link className="edge" to={`/u/${canonicalizeUsername(draft.username)}`}>
            View public profile
          </Link>
        </div>
      </div>
    );
  }

  const visibilityText: Record<string, string> = {
    only_me: "Only me",
    connections: "Connections",
    everyone: "Everyone",
  };
  const visibilitySelect = (
    label: string,
    value: string,
    allowed: readonly string[],
    onChange: (v: string) => void,
    hint: string,
  ) => (
    <label className="settings-select">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowed.map((option) => (
          <option key={option} value={option}>
            {visibilityText[option] ?? option}
          </option>
        ))}
      </select>
      <small className="hint">{hint}</small>
    </label>
  );

  return (
    <div className="profile-settings editing">
      <div className="settings-head">
        <Avatar
          name={userName}
          url={avatarSrc}
          large
        />
        <div className="settings-avatar-actions">
          <button
            className="avatar-button"
            onClick={() => fileRef.current?.click()}
            type="button"
            aria-label="Change profile picture"
          >
            Change photo
          </button>
          {avatarSrc && (
            <button
              className="edge"
              onClick={() => {
                setAvatarDraft(null);
                patch({ avatarUrl: "" });
              }}
              type="button"
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => pickAvatar(e.target.files?.[0])}
        />
      </div>

      <section className="settings-section" aria-label="Public profile">
        <h3>Public profile</h3>
        <label className="settings-field">
          Display name <small>How your name appears in conversations.</small>
          <input
            value={draft.displayName}
            onChange={(e) => patch({ displayName: e.target.value })}
            maxLength={80}
            className={errors.displayName ? "invalid" : ""}
          />
        </label>
        <label className="settings-field">
          Username <small>How people find and @mention you.</small>
          <input
            value={draft.username}
            onChange={(e) => onUsernameChange(e.target.value)}
            maxLength={32}
            className={errors.username ? "invalid" : ""}
            autoCapitalize="none"
            spellCheck={false}
          />
          {usernameHint.kind !== "idle" && (
            <small
              className={
                usernameHint.kind === "available"
                  ? "hint good"
                  : usernameHint.kind === "taken" || usernameHint.kind === "invalid"
                    ? "hint bad"
                    : "hint"
              }
            >
              {usernameHint.kind === "checking"
                ? "Checking availability…"
                : usernameHint.kind === "available"
                  ? "Username available."
                  : usernameHint.kind === "taken"
                    ? "That username is taken."
                    : "Use 3–32 lowercase letters, numbers, or underscores."}
            </small>
          )}
        </label>
        <label className="settings-field">
          Bio <small>Type @ to mention someone by username.</small>
          {draft.bio.length > 450 && !errors.bio && <small className="hint">{draft.bio.length}/500</small>}
          <MentionTextarea
            value={draft.bio}
            onChange={(next) => patch({ bio: next })}
            onAddRef={onAddMentionRef}
            maxLength={500}
            disabled={isSaving}
          />
          {errors.bio && <small className="hint bad">{errors.bio}</small>}
        </label>
        <label className="settings-field">
          Pronouns <small>Comma-separated, e.g. she/her, they/them.</small>
          <input
            value={draft.pronouns.join(", ")}
            onChange={(e) => patch({ pronouns: normalizePronouns(e.target.value) })}
            maxLength={160}
            className={errors.pronouns ? "invalid" : ""}
          />
          {errors.pronouns && <small className="hint bad">{errors.pronouns}</small>}
        </label>
        <label className="settings-field">
          Status line <small>A short optional line, like “Building in the open”.</small>
          <input
            value={draft.profileStatus}
            onChange={(e) => patch({ profileStatus: e.target.value })}
            maxLength={80}
            className={errors.profileStatus ? "invalid" : ""}
          />
        </label>
      </section>

      <section className="settings-section" aria-label="Featured song">
        <h3>Featured song</h3>
        <p className="note">
          Shown on your profile, text only. Playback needs a licensed music
          source, which isn’t wired up yet — so no fake player.
        </p>
        {draft.featuredSong ? (
          <div className="song-row">
            <label className="settings-field">
              Title
              <input
                value={draft.featuredSong.title}
                onChange={(e) =>
                  patch({ featuredSong: { ...draft.featuredSong!, title: e.target.value } })
                }
                maxLength={80}
                className={errors.featuredSong ? "invalid" : ""}
              />
            </label>
            <label className="settings-field">
              Artist
              <input
                value={draft.featuredSong.artist}
                onChange={(e) =>
                  patch({ featuredSong: { ...draft.featuredSong!, artist: e.target.value } })
                }
                maxLength={120}
                className={errors.featuredSong ? "invalid" : ""}
              />
            </label>
            <button
              className="edge"
              type="button"
              onClick={() => patch({ featuredSong: null })}
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            className="room-join"
            type="button"
            onClick={() => patch({ featuredSong: { title: "", artist: "" } })}
          >
            Add a featured song
          </button>
        )}
        {errors.featuredSong && <small className="hint bad">{errors.featuredSong}</small>}
      </section>

      <section className="settings-section" aria-label="Links">
        <h3>Links</h3>
        {draft.links.length === 0 && <p className="note">Add links like your blog, code, or a project.</p>}
        {draft.links.map((link, i) => (
          <div className="link-row" key={link.id}>
            <label className="settings-field">
              Label
              <input
                value={link.label}
                onChange={(e) => updateLink(link.id, { label: e.target.value })}
                maxLength={40}
                className={errors[`link:${link.id}`] ? "invalid" : ""}
                aria-label={`Link ${i + 1} label`}
              />
            </label>
            <label className="settings-field">
              URL
              <input
                value={link.url}
                onChange={(e) => updateLink(link.id, { url: e.target.value })}
                maxLength={2048}
                placeholder="https://example.com"
                className={errors[`link:${link.id}`] ? "invalid" : ""}
                aria-label={`Link ${i + 1} URL`}
              />
            </label>
            <label className="settings-select">
              Who can see it
              <select
                value={link.visibility}
                onChange={(e) => updateLink(link.id, { visibility: e.target.value as DraftLink["visibility"] })}
              >
                {VISIBLE_TO_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === "only_me" ? "Only me" : option === "connections" ? "Connections" : "Everyone"}
                  </option>
                ))}
              </select>
            </label>
            <button className="edge" type="button" onClick={() => removeLink(link.id)}>
              Remove
            </button>
            {errors[`link:${link.id}`] && (
              <small className="hint bad">{errors[`link:${link.id}`]}</small>
            )}
          </div>
        ))}
        <button
          className="room-join"
          type="button"
          onClick={addLink}
          disabled={draft.links.length >= 8}
        >
          Add a link
        </button>
      </section>

      <section className="settings-section" aria-label="Personal information">
        <h3>Personal information</h3>
        <p className="note">
          Optional details, stored separately from your public profile.
        </p>
        <label className="settings-field">
          Real name <small>Never required — only used if you add it.</small>
          <input
            value={draft.realName}
            onChange={(e) => patch({ realName: e.target.value })}
            maxLength={80}
            className={errors.realName ? "invalid" : ""}
          />
        </label>
        <label className="settings-field">
          Date of birth <small>Used to show your age — never a full birth date.</small>
          <input
            type="date"
            value={draft.dateOfBirth}
            onChange={(e) => patch({ dateOfBirth: e.target.value })}
            className={errors.dateOfBirth ? "invalid" : ""}
          />
          {errors.dateOfBirth && <small className="hint bad">{errors.dateOfBirth}</small>}
        </label>
        <label className="settings-field">
          Location <small>Optional, e.g. “Portugal” or “Lisbon”.</small>
          <input
            value={draft.locationText}
            onChange={(e) => patch({ locationText: e.target.value })}
            maxLength={80}
            className={errors.locationText ? "invalid" : ""}
          />
        </label>
        {visibilitySelect(
          "Personal info visibility",
          draft.personalVisibility,
          VISIBLE_TO_OPTIONS,
          (v) => patch({ personalVisibility: v as ProfileDraft["personalVisibility"] }),
          "Real name, birth date, and location are shown to you; only share them with connections or everyone if you choose.",
        )}
        {visibilitySelect(
          "Location visibility",
          draft.locationVisibility,
          VISIBLE_TO_OPTIONS,
          (v) => patch({ locationVisibility: v as ProfileDraft["locationVisibility"] }),
          "Controls the short location line above.",
        )}
      </section>

      <section className="settings-section" aria-label="Privacy">
        <h3>Privacy</h3>
        <label className="settings-toggle">
          <span>
            Public profile
            <small>Anyone can view your profile when this is on.</small>
          </span>
          <input
            type="checkbox"
            checked={draft.discoverable}
            onChange={(e) => patch({ discoverable: e.target.checked })}
          />
        </label>
        <label className="settings-toggle">
          <span>
            Accept message requests
            <small>Let people you’ve never talked to send you a request.</small>
          </span>
          <input
            type="checkbox"
            checked={draft.contactable}
            onChange={(e) => patch({ contactable: e.target.checked })}
          />
        </label>
        {visibilitySelect(
          "Who can @mention you?",
          draft.mentionVisibility,
          MENTION_VISIBILITY_OPTIONS,
          (v) => patch({ mentionVisibility: v as ProfileDraft["mentionVisibility"] }),
          "Usernames are already public in conversations; this sets who can link your name in bios.",
        )}
        <p className="note">
          Online status, read receipts, and typing indicators are not available
          anywhere in OFF — there is no presence system to switch off.
        </p>
      </section>

      <div className="settings-footer">
        <button className="primary" onClick={save} disabled={isSaving} type="button">
          {saveButtonLabel(saveState)}
        </button>
        <button className="edge" onClick={close} disabled={isSaving} type="button">
          {dirty ? "Discard" : "Close"}
        </button>
        {savedMsg && (
          <p className="status error" role="alert">
            {savedMsg}
          </p>
        )}
        {saveState.status === "saved" && !dirty && (
          <p className="status" role="status">
            Saved.
          </p>
        )}
        {isSaving && (
          <p className="status" role="status">
            Saving…
          </p>
        )}
        {error && (
          <p className="status error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}