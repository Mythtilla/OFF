import { useState } from "react";

export function ProfileStep({
  error,
  onContinue,
}: {
  error: string;
  onContinue: (displayName: string, bio: string) => void;
}) {
  const [displayName, setDisplayName] = useState(""),
    [bio, setBio] = useState(""),
    [submitting, setSubmitting] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSubmitting(true);
    onContinue(displayName.trim(), bio.trim());
  }

  return (
    <main className="auth">
      <form onSubmit={submit}>
        <b>OFF</b>
        <p className="eyebrow">STEP 2 OF 4</p>
        <h1>Create your profile.</h1>
        <label>
          Display name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            required
            autoFocus
          />
        </label>
        <label>
          Bio (optional)
          <input
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={500}
          />
        </label>
        <button className="primary" disabled={submitting || !displayName.trim()}>
          Continue <span>→</span>
        </button>
        {error && (
          <p className="status" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
