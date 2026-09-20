import { Link } from "../../lib/Link";
import { buildBioSegments, type MentionEntry } from "../../services/profile/mentions";

export function MentionText({
  text,
  mentions,
  blocked = new Set<string>(),
}: {
  text: string;
  mentions: MentionEntry[];
  blocked?: Set<string>;
}) {
  const segments = buildBioSegments(text, mentions, blocked);
  return (
    <span className="mention-text">
      {segments.map((segment, i) =>
        segment.kind === "mention" ? (
          <Link key={i} to={`/u/${segment.username}`} className="mention">
            {segment.token}
          </Link>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </span>
  );
}