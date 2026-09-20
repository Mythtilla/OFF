import { Link } from "../../lib/Link";
import { Avatar } from "../chat/Avatar";
import { MentionText } from "./MentionText";
import type { ProfileDraft, MentionRef } from "../../services/profile/save";

/**
 * How a signed-in stranger would see the draft profile once it is saved and
 * discoverable. Private fields (real name, location, DOB) are never previewed
 * because the server discloses only age — the preview says so instead.
 */
export function ProfilePreview({ draft }: { draft: ProfileDraft }) {
  const username = draft.username || "your-username";
  const name = draft.displayName || username;
  const mentions: MentionRef[] = draft.mentionRefs;
  const visibleLinks = draft.links.filter((link) => link.visibility === "everyone");
  const mentionNote =
    draft.mentionVisibility === "nobody"
      ? "Nobody can @mention you in a bio right now."
      : draft.mentionVisibility === "connections"
        ? "Only connections can @mention you in a bio."
        : "Anyone can @mention you in a bio.";

  return (
    <div className="profile-preview" data-preview="profile">
      <p className="preview-heading note">Public preview — how a stranger sees this</p>
      <div className="preview-card">
        <div className="preview-header">
          <Avatar name={name} url={draft.avatarUrl} large />
          <div>
            <p className="view-name">{name}</p>
            <p className="view-handle">@{username}</p>
            {draft.pronouns.length > 0 && (
              <p className="view-pronouns note">{draft.pronouns.join(" / ")}</p>
            )}
          </div>
        </div>
        {draft.profileStatus && <p className="view-status note">{draft.profileStatus}</p>}
        <p className="view-bio">
          {draft.bio ? (
            <MentionText text={draft.bio} mentions={mentions} />
          ) : (
            <span className="note">No bio yet.</span>
          )}
        </p>
        {draft.featuredSong && (draft.featuredSong.title || draft.featuredSong.artist) && (
          <p className="view-song note">
            Featured: <b>{draft.featuredSong.title}</b>
            {draft.featuredSong.artist ? ` — ${draft.featuredSong.artist}` : ""}
          </p>
        )}
        {visibleLinks.length > 0 && (
          <ul className="view-links">
            {visibleLinks.map((link, i) => (
              <li key={i}>
                <Link to={link.url}>{link.label}</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="note preview-meta">{mentionNote}</p>
        {draft.personalVisibility !== "only_me" || draft.locationVisibility !== "only_me" ? (
          <p className="note preview-meta">
            Your real name, exact birth date, and location stay private; only your
            age and location line may show to the people you choose.
          </p>
        ) : null}
        {!draft.discoverable && (
          <p className="note preview-private">
            🔒 Only people you're connected with can see this profile.
          </p>
        )}
      </div>
    </div>
  );
}