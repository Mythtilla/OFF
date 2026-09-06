import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createRoot } from "react-dom/client";
import { AuthForm } from "./components/auth/AuthForm";
import { ChatShell } from "./components/chat/ChatShell";
import { isSupabaseConfigured, supabase } from "./integrations/supabase/client";
import "./styles.css";
function Landing({ onAuth }: { onAuth: () => void }) {
  return (
    <main className="landing">
      <header>
        <b>OFF</b>
        <span>Open Freedom Forum</span>
        <button onClick={onAuth}>Sign in</button>
      </header>
      <section className="hero">
        <p className="eyebrow">PRIVATE CONVERSATIONS · OPEN COMMUNITIES</p>
        <h1>
          Talk freely.
          <br />
          <i>Stay deliberate.</i>
        </h1>
        <p className="lede">
          A real-time home for pseudonymous technical communities—built to
          collect less, not to promise the impossible.
        </p>
        <button className="primary" onClick={onAuth}>
          Enter OFF <span>→</span>
        </button>
      </section>
      <section className="principles">
        <article>
          <small>01</small>
          <h2>Pseudonymous by default</h2>
          <p>No real-name requirement. Share only what a conversation needs.</p>
        </article>
        <article>
          <small>02</small>
          <h2>No surveillance stack</h2>
          <p>No ads, pixels, session replay, or behavioral analytics.</p>
        </article>
        <article>
          <small>03</small>
          <h2>Open about limits</h2>
          <p>
            Privacy features are described precisely—not marketed as anonymity
            guarantees.
          </p>
        </article>
      </section>
    </main>
  );
}
function Root() {
  const [screen, setScreen] = useState<"landing" | "auth">("landing"),
    [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  if (!isSupabaseConfigured)
    return (
      <main className="setup">
        <b>OFF</b>
        <h1>Configuration required.</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code> and provide
          the Supabase URL and publishable key. No service-role key belongs in
          this app.
        </p>
      </main>
    );
  return session ? (
    <ChatShell session={session} />
  ) : screen === "landing" ? (
    <Landing onAuth={() => setScreen("auth")} />
  ) : (
    <AuthForm onClose={() => setScreen("landing")} />
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
