function safeAvatarUrl(url?: string | null) {
  if (!url) return null;
  // Render-side mirror of the profiles_avatar_url_scheme CHECK (migration 003):
  // only http(s) URLs or inline images are ever handed to <img>.
  if (/^https:\/\//i.test(url)) return url;
  if (/^data:image\//i.test(url)) return url;
  return null;
}

export function Avatar({
  name,
  url,
  large = false,
}: {
  name: string;
  url?: string | null;
  large?: boolean;
}) {
  const src = safeAvatarUrl(url);
  if (src) {
    return (
      <img
        className={large ? "avatar large" : "avatar"}
        src={src}
        alt=""
        aria-hidden="true"
      />
    );
  }
  const letter = (name || "?").slice(0, 1).toUpperCase();
  return (
    <div className={large ? "avatar large" : "avatar"} aria-hidden="true">
      {letter}
    </div>
  );
}