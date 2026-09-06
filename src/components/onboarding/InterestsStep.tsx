import { useState } from "react";
import { interestSlugs } from "../../services/onboarding/interests";

export function InterestsStep({
  error,
  onContinue,
}: {
  error: string;
  onContinue: (slugs: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [submitting, setSubmitting] = useState(false);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  return (
    <main className="auth">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (selected.size === 0) return;
          setSubmitting(true);
          onContinue([...selected]);
        }}
      >
        <b>OFF</b>
        <p className="eyebrow">STEP 4 OF 4</p>
        <h1>Interests.</h1>
        <p style={{ color: "#bbb8b1", lineHeight: 1.5 }}>
          Pick at least one community to join.
        </p>
        <div className="interest-grid">
          {[...interestSlugs].map((slug) => (
            <button
              key={slug}
              type="button"
              className={selected.has(slug) ? "selected" : ""}
              onClick={() => toggle(slug)}
            >
              {slug}
            </button>
          ))}
        </div>
        <button
          className="primary"
          disabled={submitting || selected.size === 0}
        >
          {submitting ? "Working…" : "Join & Finish"} <span>→</span>
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
