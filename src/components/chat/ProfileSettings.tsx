import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
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

export type ProfileEditTab = "profile" | "links" | "personal" | "privacy";

export const PROFILE_TABS: readonly { id: ProfileEditTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "links", label: "Links" },
  { id: "personal", label: "Personal" },
  { id: "privacy", label: "Privacy" },
];

export function visibilityOptionLabel(option: string): string {
  switch (option) {
    case "nobody":
      return "No one";
    case "only_me":
      return "Only me";
    case "connections":
      return "Connections";
    case "everyone":
      return "Everyone";
    default:
      return option;
  }
}

export function VisibilitySegmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  compact = false,
}: {
  label?: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className="ps-field">
      {label && <span className="ps-label">{label}</span>}
      <div
        className={compact ? "ps-segmented ps-segmented-sm" : "ps-segmented"}
        role="radiogroup"
        aria-label={label ?? "Choose one"}
      >
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={option === value}
            className={option === value ? "active" : ""}
            onClick={() => onChange(option)}
          >
            {visibilityOptionLabel(String(option))}
          </button>
        ))}
      </div>
      {hint && <small className="ps-hint">{hint}</small>}
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="ps-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="ps-switch-text">
        {label}
        {description && <small>{description}</small>}
      </span>
      <i className="ps-switch-track" aria-hidden="true" />
    </label>
  );
}

function Field({
  label,
  hint,
  right,
  invalid,
  children,
}: {
  label: string;
  hint?: string;
  right?: ReactNode;
  invalid?: string;
  children: ReactNode;
}) {
  return (
    <label className="ps-field">
      <span className="ps-label-row">
        <span className="ps-label">{label}</span>
        {right}
      </span>
      {children}
      {invalid ? (
        <small className="ps-hint bad">{invalid}</small>
      ) : hint ? (
        <small className="ps-hint">{hint}</small>
      ) : null}
    </label>
  );
}

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
  const [activeTab, setActiveTab] = useState<ProfileEditTab>("profile");
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
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : "Couldn't save. Try again." });
    }
  }

  function close() {
    if (draft && baseline && draftDirty(baseline, draft)) {
      if (!window.confirm("Discard unsaved profile changes?")) return;
    }
    setEditing(false);
    setActiveTab("profile");
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
  const pillClass =
    usernameHint.kind === "available"
      ? "ps-status-pill good"
      : usernameHint.kind === "taken" || usernameHint.kind === "invalid"
        ? "ps-status-pill bad"
        : usernameHint.kind === "checking"
          ? "ps-status-pill"
          : "";
  const pillText =
    usernameHint.kind === "checking"
      ? "Checking…"
      : usernameHint.kind === "available"
        ? "Available"
        : usernameHint.kind === "taken"
          ? "Taken"
          : usernameHint.kind === "invalid"
            ? "Check format"
            : "";
  const usernameError =
    errors.username && usernameHint.kind === "idle" ? errors.username : undefined;

  if (!editing) {
    return (
      <div className="profile-settings">
        <div className="ps-view">
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
          <p className="note view-meta">
            {draft.discoverable
              ? "Your profile is public — anyone can view it."
              : "Your profile is private — only connected people can view it."}
          </p>
          <div className="view-actions">
            <button className="room-join" onClick={() => setEditing(true)} type="button">
              Edit profile
            </button>
            <Link className="ps-secondary" to={`/u/${canonicalizeUsername(draft.username)}`}>
              View public profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-settings editing">
      <h2 className="visually-hidden">Edit profile</h2>

      <div className="ps-tabs" role="group" aria-label="Profile sections">
        {PROFILE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="ps-tab"
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <div className="ps-panes" role="tabpanel">
          <div className="ps-card ps-avatar-card">
            <Avatar name={userName} url={avatarSrc} large />
            <div className="ps-avatar-actions">
              <button
                className="ps-secondary"
                onClick={() => fileRef.current?.click()}
                type="button"
                aria-label="Change profile picture"
              >
                Change photo
              </button>
              {avatarSrc && (
                <button
                  className="ps-secondary ps-remove"
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
            <small className="ps-hint">Photos are cropped to a circle. JPEG, PNG, or WebP.</small>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => pickAvatar(e.target.files?.[0])}
            />
          </div>

          <div className="ps-card">
            <h3 className="ps-card-title">Identity &amp; bio</h3>
            <p className="ps-card-desc">How you appear in conversations and on your public profile.</p>
            <Field
              label="Display name"
              hint="How your name appears in conversations."
              invalid={errors.displayName}
            >
              <input
                value={draft.displayName}
                onChange={(e) => patch({ displayName: e.target.value })}
                maxLength={80}
                className={errors.displayName ? "invalid" : ""}
              />
            </Field>
            <Field
              label="Username"
              hint="How people find and @mention you."
              invalid={usernameError}
              right={pillClass ? <span className={pillClass}>{pillText}</span> : null}
            >
              <input
                value={draft.username}
                onChange={(e) => onUsernameChange(e.target.value)}
                maxLength={32}
                className={errors.username ? "invalid" : ""}
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Bio"
              hint="Type @ to mention someone by username."
              right={<span className="ps-count">{draft.bio.length}/500</span>}
            >
              <MentionTextarea
                value={draft.bio}
                onChange={(next) => patch({ bio: next })}
                onAddRef={onAddMentionRef}
                maxLength={500}
                disabled={isSaving}
              />
            </Field>
            <Field
              label="Pronouns"
              hint="Comma-separated, e.g. she/her, they/them."
              invalid={errors.pronouns}
            >
              <input
                value={draft.pronouns.join(", ")}
                onChange={(e) => patch({ pronouns: normalizePronouns(e.target.value) })}
                maxLength={160}
                className={errors.pronouns ? "invalid" : ""}
              />
            </Field>
            <Field
              label="Status line"
              hint="A short optional line, like “Building in the open”."
              invalid={errors.profileStatus}
            >
              <input
                value={draft.profileStatus}
                onChange={(e) => patch({ profileStatus: e.target.value })}
                maxLength={80}
                className={errors.profileStatus ? "invalid" : ""}
              />
            </Field>
          </div>

          <div className="ps-card">
            <h3 className="ps-card-title">Featured song</h3>
            <p className="ps-card-desc">
              Shown on your profile as text only. Playback needs a licensed music source, which
              isn’t wired up yet — so no fake player.
            </p>
            {draft.featuredSong ? (
              <div className="ps-song-grid">
                <Field label="Title" invalid={errors.featuredSong} hint="Required to keep the song.">
                  <input
                    value={draft.featuredSong.title}
                    onChange={(e) =>
                      patch({ featuredSong: { ...draft.featuredSong!, title: e.target.value } })
                    }
                    maxLength={80}
                    className={errors.featuredSong ? "invalid" : ""}
                  />
                </Field>
                <Field label="Artist">
                  <input
                    value={draft.featuredSong.artist}
                    onChange={(e) =>
                      patch({ featuredSong: { ...draft.featuredSong!, artist: e.target.value } })
                    }
                    maxLength={120}
                    className={errors.featuredSong ? "invalid" : ""}
                  />
                </Field>
              </div>
            ) : (
              <div className="ps-empty">
                <p>No featured song yet.</p>
              </div>
            )}
            {draft.featuredSong ? (
              <button
                className="ps-secondary ps-remove"
                type="button"
                onClick={() => patch({ featuredSong: null })}
              >
                Remove song
              </button>
            ) : (
              <button
                className="ps-add-row"
                type="button"
                onClick={() => patch({ featuredSong: { title: "", artist: "" } })}
              >
                + Add a featured song
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === "links" && (
        <div className="ps-panes" role="tabpanel">
          <div className="ps-card">
            <h3 className="ps-card-title">Links</h3>
            <p className="ps-card-desc">Shown on your public profile. Up to eight.</p>
            {draft.links.length === 0 && (
              <div className="ps-empty">
                <p>No links yet — add your blog, code, or a project.</p>
              </div>
            )}
            {draft.links.map((link, i) => (
              <div className="ps-link-row" key={link.id}>
                <Field label="Label" invalid={errors[`link:${link.id}`]}>
                  <input
                    value={link.label}
                    onChange={(e) => updateLink(link.id, { label: e.target.value })}
                    maxLength={40}
                    className={errors[`link:${link.id}`] ? "invalid" : ""}
                    aria-label={`Link ${i + 1} label`}
                  />
                </Field>
                <Field label="URL" hint="Full address, e.g. https://example.com">
                  <input
                    value={link.url}
                    onChange={(e) => updateLink(link.id, { url: e.target.value })}
                    maxLength={2048}
                    placeholder="https://example.com"
                    className={errors[`link:${link.id}`] ? "invalid" : ""}
                    aria-label={`Link ${i + 1} URL`}
                  />
                </Field>
                <VisibilitySegmented
                  compact
                  label="Who can see it"
                  value={link.visibility}
                  options={VISIBLE_TO_OPTIONS}
                  onChange={(v) => updateLink(link.id, { visibility: v })}
                />
                <button className="ps-link-remove" type="button" onClick={() => removeLink(link.id)}>
                  Remove
                </button>
              </div>
            ))}
            <button
              className="ps-add-row"
              type="button"
              onClick={addLink}
              disabled={draft.links.length >= 8}
            >
              + Add a link
            </button>
          </div>
        </div>
      )}

      {activeTab === "personal" && (
        <div className="ps-panes" role="tabpanel">
          <div className="ps-card">
            <h3 className="ps-card-title">Personal information</h3>
            <p className="ps-card-desc">
              Optional details, stored separately from your public profile. Only your age is ever
              shown to others — never a full birth date.
            </p>
            <Field label="Real name" hint="Never required — only used if you add it." invalid={errors.realName}>
              <input
                value={draft.realName}
                onChange={(e) => patch({ realName: e.target.value })}
                maxLength={80}
                className={errors.realName ? "invalid" : ""}
              />
            </Field>
            <Field label="Date of birth" hint="Used to show your age — never a full birth date." invalid={errors.dateOfBirth}>
              <input
                type="date"
                value={draft.dateOfBirth}
                onChange={(e) => patch({ dateOfBirth: e.target.value })}
                className={errors.dateOfBirth ? "invalid" : ""}
              />
            </Field>
            <Field label="Location" hint="Optional, e.g. “Portugal” or “Lisbon”." invalid={errors.locationText}>
              <input
                value={draft.locationText}
                onChange={(e) => patch({ locationText: e.target.value })}
                maxLength={80}
                className={errors.locationText ? "invalid" : ""}
              />
            </Field>
            <div className="ps-divider" />
            <VisibilitySegmented
              label="Who can see your personal details"
              value={draft.personalVisibility}
              options={VISIBLE_TO_OPTIONS}
              onChange={(v) => patch({ personalVisibility: v as ProfileDraft["personalVisibility"] })}
              hint="Real name, birth date, and location are shown to you; share them with connections or everyone only if you choose."
            />
            <VisibilitySegmented
              label="Location visibility"
              value={draft.locationVisibility}
              options={VISIBLE_TO_OPTIONS}
              onChange={(v) => patch({ locationVisibility: v as ProfileDraft["locationVisibility"] })}
              hint="Controls the short location line on your profile."
            />
          </div>
        </div>
      )}

      {activeTab === "privacy" && (
        <div className="ps-panes" role="tabpanel">
          <div className="ps-card">
            <h3 className="ps-card-title">Privacy &amp; safety</h3>
            <p className="ps-card-desc">Who can find you, see you, and reach out.</p>
            <SwitchRow
              label="Public profile"
              description="Anyone can view your profile when this is on."
              checked={draft.discoverable}
              onChange={(v) => patch({ discoverable: v })}
            />
            <SwitchRow
              label="Accept message requests"
              description="Let people you’ve never talked to send you a request."
              checked={draft.contactable}
              onChange={(v) => patch({ contactable: v })}
            />
            <div className="ps-divider" />
            <VisibilitySegmented
              label="Who can @mention you"
              value={draft.mentionVisibility}
              options={MENTION_VISIBILITY_OPTIONS}
              onChange={(v) => patch({ mentionVisibility: v as ProfileDraft["mentionVisibility"] })}
              hint="Usernames are already public in conversations; this sets who can link your name in bios."
            />
            <p className="ps-note">
              Online status, read receipts, and typing indicators are not available anywhere in OFF —
              there is no presence system to switch off.
            </p>
          </div>
        </div>
      )}

      {(dirty || saveState.status !== "pristine") && (
        <div className="ps-savebar">
          <div className="ps-savebar-status">
            {savedMsg && (
              <p className="ps-error" role="alert">
                {savedMsg}
              </p>
            )}
            {error && !savedMsg && (
              <p className="ps-error" role="alert">
                {error}
              </p>
            )}
            {isSaving && (
              <p className="ps-status-text" role="status">
                Saving changes…
              </p>
            )}
            {saveState.status === "saved" && !dirty && (
              <p className="ps-status-text ok" role="status">
                Saved · just now
              </p>
            )}
          </div>
          <div className="ps-savebar-actions">
            <button className="primary ps-save" onClick={save} disabled={isSaving || !dirty} type="button">
              {saveButtonLabel(saveState)}
            </button>
            <button className="ps-secondary ps-discard" onClick={close} disabled={isSaving} type="button">
              {dirty ? "Discard" : "Close"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}