import { useEffect, useMemo, useState } from "react";
import { signIn, signUp } from "../../services/auth/service";
import {
  canonicalizeUsername,
  validateUsername,
} from "../../services/auth/username";
import { recoveryNotice, recoveryPhraseValid } from "../../services/auth/recovery";
import { supabase } from "../../integrations/supabase/client";
import {
  checkUsername,
  type UsernameCheck,
} from "../../services/auth/availability";
import {
  levelLabel,
  passwordLevel,
  type PasswordLevel,
} from "../../services/auth/strength";
import { safeAuthError } from "../../services/auth/errors";
import { debounce } from "../../utils/debounce";

const meterSegments = 4;

function strengthTone(level: PasswordLevel | null) {
  if (!level || level === "too-short") return "bad";
  if (level === "weak" || level === "fair") return "muted";
  return "ok";
}

function safeRecoveryError(message: string) {
  if (message.includes("Too many recovery attempts"))
    return "Too many recovery attempts. Try again later.";
  if (message.includes("Recovery failed"))
    return "The username, recovery phrase, or new password is incorrect.";
  return safeAuthError(message);
}

export function AuthForm({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in"),
    [recovery, setRecovery] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [recoveryPhrase, setRecoveryPhrase] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [status, setStatus] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [usernameCheck, setUsernameCheck] = useState<UsernameCheck>({
      status: "idle",
      suggestions: [],
    });

  const strength = useMemo(
    () => (mode === "sign_up" ? passwordLevel(password) : null),
    [mode, password],
  );

  useEffect(() => {
    const name = canonicalizeUsername(username);
    if (!name) {
      setUsernameCheck({ status: "idle", suggestions: [] });
      return;
    }
    if (validateUsername(name)) {
      setUsernameCheck({ status: "invalid", suggestions: [] });
      return;
    }
    let alive = true;
    setUsernameCheck({ status: "checking", suggestions: [] });
    const watcher = debounce(async () => {
      const result = await checkUsername(name);
      if (alive) setUsernameCheck(result);
    }, 350);
    watcher.schedule();
    return () => {
      alive = false;
      watcher.cancel();
    };
  }, [username, mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateUsername(username);
    if (invalid) return setStatus(invalid);
    if (mode === "sign_up" && usernameCheck.status === "unavailable")
      return setStatus("This username is already taken.");
    setSubmitting(true);
    setStatus("Working…");
    try {
      const result =
        mode === "sign_in"
          ? await signIn(username, password)
          : await signUp(username, password);
      if (result.error) {
        setStatus(safeAuthError(result.error.message));
      } else if (mode === "sign_up") {
        setStatus("Account created. Sign in to continue.");
      }
    } catch {
      setStatus("Network error. Please try again.");
    }
setSubmitting(false);
  }

  async function submitRecovery(e: React.FormEvent) {
    e.preventDefault();
    const name = canonicalizeUsername(username);
    const invalid = validateUsername(name);
    if (invalid) return setStatus(invalid);
    const cleanPhrase = recoveryPhrase.trim().replace(/\s+/g, " ");
    if (!recoveryPhraseValid(cleanPhrase)) {
      setStatus("Enter the 24-word recovery phrase from setup.");
      return;
    }
    setSubmitting(true);
    setStatus("Working…");
    try {
      const { error } = await supabase!.rpc("recover_account", {
        p_username: name,
        p_phrase: cleanPhrase,
        p_new_password: newPassword,
      });
      if (error) {
        setStatus(safeRecoveryError(error.message));
      } else {
        setRecovery(false);
        setNewPassword("");
        setRecoveryPhrase("");
        setStatus("Password reset. Sign in with your new password.");
      }
    } catch {
      setStatus("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  const hint =
    usernameCheck.status === "checking"
      ? { text: "Checking availability…", tone: "muted" }
      : usernameCheck.status === "available"
        ? { text: `${canonicalizeUsername(username)} is available`, tone: "ok" }
        : usernameCheck.status === "unavailable"
          ? {
              text: `${canonicalizeUsername(username)} is taken`,
              tone: "bad",
            }
          : usernameCheck.status === "invalid"
            ? { text: validateUsername(username) ?? "", tone: "bad" }
            : null;

  const litSegments =
    strength === "too-short"
      ? 0
      : strength === "weak"
        ? 1
        : strength === "fair"
          ? 2
          : strength === "strong"
            ? 3
            : 4;

  function handleSubmit(e: React.FormEvent) {
    if (recovery) void submitRecovery(e);
    else void submit(e);
  }

  return (
    <main className="auth">
      <button className="back" onClick={onClose}>
        ← Back
      </button>
      <form onSubmit={handleSubmit}>
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
            onChange={(e) =>
              setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
            }
            minLength={3}
            maxLength={32}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-autocomplete="list"
            required
          />
        </label>
        {mode === "sign_up" && hint && (
          <p className={`hint ${hint.tone}`} role="status">
            {hint.text}
          </p>
        )}
        {mode === "sign_up" &&
          usernameCheck.status === "unavailable" &&
          usernameCheck.suggestions.length > 0 && (
            <div className="suggestions">
              {usernameCheck.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setUsername(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        {recovery ? (
          <>
            <label>
              Recovery phrase
              <textarea
                className="recovery-phrase"
                value={recoveryPhrase}
                onChange={(e) => setRecoveryPhrase(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                rows={3}
                maxLength={200}
                required
              />
            </label>
            <label>
              New password
              <span className="pass-row">
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  minLength={6}
                  maxLength={72}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            {mode === "sign_in" && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setRecovery(false);
                  setStatus("");
                }}
              >
                Back to sign in
              </button>
            )}
          </>
        ) : (
          <>
            <label>
              Password
              <span className="pass-row">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  minLength={6}
                  autoComplete={
                    mode === "sign_in" ? "current-password" : "new-password"
                  }
                  required
                />
                <button
                  type="button"
                  className="toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            {mode === "sign_in" && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setRecovery(true);
                  setStatus("");
                }}
              >
                Forgot your recovery phrase?
              </button>
            )}
          </>
        )}
        {mode === "sign_up" && !recovery && (
          <>
            <div
              className={`meter ${strength ?? "too-short"}`}
              aria-hidden="true"
            >
              {Array.from({ length: meterSegments }, (_, index) => (
                <i
                  key={index}
                  className={index < litSegments ? "on" : ""}
                />
              ))}
            </div>
            <p
              className={`hint ${strengthTone(strength)}`}
              role="status"
            >
              {strength ? `Strength: ${levelLabel[strength]}` : ""}
            </p>
          </>
        )}
        <button className="primary" disabled={submitting}>
          {submitting
            ? "Working…"
            : recovery
              ? "Reset password"
              : mode === "sign_in"
                ? "Continue"
                : "Create account"}{" "}
          <span>→</span>
        </button>
        {!recovery && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === "sign_in" ? "sign_up" : "sign_in");
              setStatus("");
            }}
          >
            {mode === "sign_in"
              ? "New here? Create an account"
              : "Already registered? Sign in"}
          </button>
        )}
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