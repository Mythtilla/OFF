export function Avatar({
  name,
  url,
  large = false,
}: {
  name: string;
  url?: string | null;
  large?: boolean;
}) {
  if (url) {
    return (
      <img
        className={large ? "avatar large" : "avatar"}
        src={url}
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