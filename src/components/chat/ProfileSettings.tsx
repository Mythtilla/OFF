import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../integrations/supabase/client";
import type { Profile } from "../../services/chat/types";
import { Avatar } from "./Avatar";

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
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const source = Math.min(img.width, img.height);
  const sx = (img.width - source) / 2;
  const sy = (img.height - source) / 2;
  ctx.drawImage(img, sx, sy, source, source, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL("image/jpeg", 0.85);
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
  const [displayName, setDisplayName] = useState(profile.display_name ?? ""),
    [bio, setBio] = useState(profile.bio ?? ""),
    [discoverable, setDiscoverable] = useState(!!profile.discoverable),
    [contactable, setContactable] = useState(!!profile.contactable),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState(false),
    [avatarDraft, setAvatarDraft] = useState<string | null>(null),
    fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(profile.display_name ?? "");
    setBio(profile.bio ?? "");
    setDiscoverable(!!profile.discoverable);
    setContactable(!!profile.contactable);
  }, [profile]);

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await downscaleToAvatar(await readImage(file));
      setAvatarDraft(dataUrl);
      setStatus("");
    } catch {
      setStatus("Couldn't process that image. Try a JPEG or PNG.");
    }
  }

  async function save() {
    setStatus("");
    const { data, error } = await supabase!
      .from("profiles")
      .update({
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        avatar_url: avatarDraft ?? profile.avatar_url,
        discoverable,
        contactable,
      })
      .eq("id", session.user.id)
      .select("id,username,display_name,avatar_url,bio,discoverable,contactable")
      .single();
    if (error) {
      setStatus("Couldn't save your settings.");
      return;
    }
    onSaved(data as Profile);
    setAvatarDraft(null);
    setEditing(false);
    setStatus("Saved.");
  }

  const avatarSrc = avatarDraft ?? profile.avatar_url;

  return (
    <div className="profile-settings">
      {editing ? (
        <>
          <button
            className="avatar-button"
            onClick={() => fileRef.current?.click()}
            type="button"
            aria-label="Change profile picture"
          >
            <Avatar name={displayName || profile.username || "?"} url={avatarSrc} large />
            <span>Change photo</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => pickAvatar(e.target.files?.[0])}
          />
          <label className="settings-field">
            Display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </label>
          <label className="settings-field">
            Bio (optional)
            <input
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={500}
            />
          </label>
          <label className="settings-toggle">
            <span>
              Discoverable
              <small>Appear in community lists and searches</small>
            </span>
            <input
              type="checkbox"
              checked={discoverable}
              onChange={(e) => setDiscoverable(e.target.checked)}
            />
          </label>
          <label className="settings-toggle">
            <span>
              Contactable
              <small>Accept new conversation requests</small>
            </span>
            <input
              type="checkbox"
              checked={contactable}
              onChange={(e) => setContactable(e.target.checked)}
            />
          </label>
          <button className="primary" onClick={save}>
            Save
          </button>
          {status && (
            <p className="status" role="status">
              {status}
            </p>
          )}
        </>
      ) : (
        <>
          <Avatar name={displayName || profile.username || "?"} url={avatarSrc} large />
          <p className="note">
            {profile.bio || "No bio yet."}
          </p>
          <button className="room-join" onClick={() => setEditing(true)}>
            Edit profile
          </button>
        </>
      )}
    </div>
  );
}