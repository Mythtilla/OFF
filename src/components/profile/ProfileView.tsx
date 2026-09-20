import { useEffect, useState } from "react";
import { Link } from "../../lib/Link";
import { useHead, absoluteUrl } from "../../lib/head";
import { Avatar } from "../chat/Avatar";
import { MentionText } from "./MentionText";
import { loadPublicProfile, type PublicProfile } from "../../services/profile/profile";
import { probeMessagingFeatures } from "../../services/chat/features";

const NOT_FOUND_BODY =
  "This profile doesn't exist, has a private profile, or has blocked you.";

export function ProfileView({ username }: { username: string }) {
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [messagingReady, setMessagingReady] = useState<boolean | null>(null);
  const [messageNote, setMessageNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(undefined);
    setMessageNote(null);
    loadPublicProfile(username).then((result) => {
      if (!cancelled) setProfile(result);
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    probeMessagingFeatures().then((features) => setMessagingReady(features.dmRequests));
  }, []);

  const notFound = profile === null;
  const name = profile ? profile.display_name || profile.username : username;
  useHead(
    notFound
      ? { title: "Profile not found — OFF", description: NOT_FOUND_BODY, path: `/u/${username}` }
      : {
          title: `${name} (@${username}) — OFF`,
          description: profile?.bio
            ? profile.bio.slice(0, 160)
            : `Profile for @${username} on OFF.`,
          path: `/u/${username}`,
          jsonLd: profile
            ? [
                {
                  id: "profile-person",
                  value: {
                    "@context": "https://schema.org",
                    "@type": "Person",
                    name,
                    url: absoluteUrl(`/u/${username}`),
                    image: profile.avatar_url || absoluteUrl("/og-image.png"),
                    description: profile.bio ?? undefined,
                  },
                },
              ]
            : [],
        },
  );

  if (profile === undefined) {
    return (
      <main className="profile-view">
        <nav className="profile-nav">
          <Link to="/" className="back">
            ← Back to OFF
          </Link>
        </nav>
        <p className="note" role="status">
          Loading profile…
        </p>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="profile-view">
        <nav className="profile-nav">
          <Link to="/" className="back">
            ← Back to OFF
          </Link>
        </nav>
        <h1>Profile not found</h1>
        <p className="note">{NOT_FOUND_BODY}</p>
      </main>
    );
  }

  const metaBits = [
    profile.age !== undefined ? `${profile.age} yrs` : null,
    profile.location ?? null,
  ].filter(Boolean);

  function onMessage() {
    setMessageNote(
      "Message requests need the updated backend, which is pending deployment — it isn't available right now.",
    );
  }

  return (
    <main className="profile-view">
      <nav className="profile-nav" aria-label="Breadcrumb">
        <Link to="/" className="back">
          ← Back to OFF
        </Link>
      </nav>
      <section className="profile-card" aria-labelledby="profile-name">
        <div className="profile-header">
          <Avatar name={name} url={profile.avatar_url} large />
          <div>
            <h1 id="profile-name" className="visually-hidden">
              {name}
            </h1>
            <p className="view-name" aria-hidden="true">
              {name}
            </p>
            <p className="view-handle">@{profile.username}</p>
            {profile.pronouns.length > 0 && (
              <p className="view-pronouns note">{profile.pronouns.join(" / ")}</p>
            )}
            {metaBits.length > 0 && (
              <p className="view-meta note">{metaBits.join(" · ")}</p>
            )}
          </div>
        </div>
        {profile.profile_status && (
          <p className="view-status note">{profile.profile_status}</p>
        )}
        {profile.bio ? (
          <p className="view-bio">
            <MentionText text={profile.bio} mentions={profile.bio_mentions} />
          </p>
        ) : null}
        {profile.featured_song &&
          (profile.featured_song.title || profile.featured_song.artist) && (
            <p className="view-song note">
              Featured: <b>{profile.featured_song.title}</b>
              {profile.featured_song.artist ? ` — ${profile.featured_song.artist}` : ""}
            </p>
          )}
        {profile.interests.length > 0 && (
          <ul className="view-interests" aria-label="Interests">
            {profile.interests.map((interest) => (
              <li key={interest}>{interest}</li>
            ))}
          </ul>
        )}
        {profile.links.length > 0 && (
          <ul className="view-links">
            {profile.links.map((link, i) => (
              <li key={i}>
                <a href={link.url} rel="me nofollow">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="profile-actions">
          {profile.viewer_is_owner ? (
            <Link to="/" className="primary">
              Edit your profile
            </Link>
          ) : (
            <>
              {profile.can_message && messagingReady === true && (
                <button className="primary" type="button" onClick={onMessage}>
                  Message
                </button>
              )}
              {profile.viewer_connected && (
                <p className="note">You're connected to {name}.</p>
              )}
              {!profile.can_message &&
                !profile.viewer_connected &&
                !profile.contactable && (
                  <p className="note">Their inbox is closed to new requests right now.</p>
                )}
              {messageNote && (
                <p className="note" role="status">
                  {messageNote}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}