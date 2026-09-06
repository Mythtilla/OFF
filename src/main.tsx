import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createRoot } from "react-dom/client";
import { AuthForm } from "./components/auth/AuthForm";
import { ChatShell } from "./components/chat/ChatShell";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { isSupabaseConfigured, supabase } from "./integrations/supabase/client";
import "./styles.css";

type ProfileRow = {
  username: string;
  recovery_acknowledged_at: string | null;
  profile_completed_at: string | null;
  country_handled_at: string | null;
  interests_handled_at: string | null;
  onboarding_completed: boolean;
};

type AppState =
  | { phase: "initializing" }
  | { phase: "error"; message: string }
  | { phase: "signed-out"; screen: "landing" | "auth" }
  | { phase: "onboarding"; session: Session; profile: ProfileRow }
  | { phase: "chat"; session: Session };

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
  const [state, setState] = useState<AppState>({ phase: "initializing" });

  async function loadProfile(session: Session) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "username,recovery_acknowledged_at,profile_completed_at,country_handled_at,interests_handled_at,onboarding_completed",
      )
      .eq("id", session.user.id)
      .single();
    if (error || !data) {
      setState({ phase: "error", message: "Couldn't load your profile." });
      return;
    }
    if (data.onboarding_completed) {
      setState({ phase: "chat", session });
    } else {
      setState({
        phase: "onboarding",
        session,
        profile: data as ProfileRow,
      });
    }
  }

  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) loadProfile(data.session);
        else setState({ phase: "signed-out", screen: "landing" });
      })
      .catch(() => setState({ phase: "signed-out", screen: "landing" }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) loadProfile(session);
      else setState({ phase: "signed-out", screen: "landing" });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
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
  }

  switch (state.phase) {
    case "initializing":
      return (
        <main className="setup">
          <b>OFF</b>
          <h1>Loading…</h1>
        </main>
      );
    case "error":
      return (
        <main className="setup">
          <b>OFF</b>
          <h1>Something went wrong.</h1>
          <p>{state.message}</p>
        </main>
      );
    case "signed-out":
      return state.screen === "landing" ? (
        <Landing
          onAuth={() => setState({ phase: "signed-out", screen: "auth" })}
        />
      ) : (
        <AuthForm
          onClose={() => setState({ phase: "signed-out", screen: "landing" })}
        />
      );
    case "onboarding":
      return (
        <OnboardingFlow
          session={state.session}
          profile={state.profile}
          onComplete={() => loadProfile(state.session)}
        />
      );
    case "chat":
      return <ChatShell session={state.session} />;
  }
}

createRoot(document.getElementById("root")!).render(<Root />);
