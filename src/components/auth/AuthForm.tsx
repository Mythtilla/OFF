import { useState } from "react";
import { signIn, signUp } from "../../services/auth/service";
import { validateUsername } from "../../services/auth/username";
import { recoveryNotice } from "../../services/auth/recovery";

function safeError(msg: string): string {
  if (msg.includes("Invalid login credentials"))
    return "Username or password is incorrect.";
  if (msg.includes("User already registered"))
    return "This username is already taken.";
  if (msg.includes("Password")) return "Password doesn't meet requirements.";
  return "Something went wrong. Please try again.";
}

export function AuthForm({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [status, setStatus] = useState(""),
    [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateUsername(username);
    if (invalid) return setStatus(invalid);
    setSubmitting(true);
    setStatus("Working…");
    try {
      const result =
        mode === "sign_in"
          ? await signIn(username, password)
          : await signUp(username, password);
      if (result.error) {
        setStatus(safeError(result.error.message));
      } else if (mode === "sign_up") {
        setStatus("Account created.");
      }
    } catch {
      setStatus("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  return (
    <main className="auth">
      <button className="back" onClick={onClose}>
        ← Back
      </button>
      <form onSubmit={submit}>
        <b>OFF</b>
        <p className="eyebrow">
          {mode === "sign_in" ? "WELCOME BACK" : "CREATE A PSEUDONYM"}
        </p>
        <h1>
          {mode === "sign_in"
            ? "Continue the conversation."
            : "Join with less exposure."}
        </h1>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={32}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            minLength={12}
            autoComplete={
              mode === "sign_in" ? "current-password" : "new-password"
            }
            required
          />
        </label>
        <button className="primary" disabled={submitting}>
          {submitting
            ? "Working…"
            : mode === "sign_in"
              ? "Sign in"
              : "Create account"}{" "}
          <span>→</span>
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "sign_in" ? "sign_up" : "sign_in");
            setStatus("");
          }}
        >
          {mode === "sign_in"
            ? "Need an account? Register"
            : "Already registered? Sign in"}
        </button>
        {status && (
          <p role="status" className="status">
            {status}
          </p>
        )}
        <p className="fine">{recoveryNotice}</p>
      </form>
    </main>
  );
}
