import { useState } from "react";

export function CountryStep({
  error,
  onContinue,
}: {
  error: string;
  onContinue: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="auth">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitting(true);
          onContinue();
        }}
      >
        <b>OFF</b>
        <p className="eyebrow">STEP 3 OF 4</p>
        <h1>Your region.</h1>
        <p style={{ color: "#bbb8b1", lineHeight: 1.5 }}>
          Country detection is not available in this version. You can continue
          without setting a region. This step will be recorded as handled.
        </p>
        <button className="primary" disabled={submitting}>
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
