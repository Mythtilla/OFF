import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../integrations/supabase/client";
import { nextOnboardingStep } from "../../services/onboarding/state";
import { RecoveryCeremony } from "./RecoveryCeremony";
import { ProfileStep } from "./ProfileStep";
import { CountryStep } from "./CountryStep";
import { InterestsStep } from "./InterestsStep";

type ProfileState = {
  username: string;
  recovery_acknowledged_at: string | null;
  profile_completed_at: string | null;
  country_handled_at: string | null;
  interests_handled_at: string | null;
  onboarding_completed: boolean;
};

export function OnboardingFlow({
  session,
  profile,
  onComplete,
}: {
  session: Session;
  profile: ProfileState;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(() =>
    nextOnboardingStep({
      recovery: !!profile.recovery_acknowledged_at,
      profile: !!profile.profile_completed_at,
      country: !!profile.country_handled_at,
      interests: !!profile.interests_handled_at,
    }),
  );
  const [error, setError] = useState("");

  async function advance() {
    const { data } = await supabase!
      .from("profiles")
      .select(
        "recovery_acknowledged_at,profile_completed_at,country_handled_at,interests_handled_at,onboarding_completed",
      )
      .eq("id", session.user.id)
      .single();
    if (!data) {
      setError("Lost connection. Please refresh.");
      return;
    }
    if (data.onboarding_completed) {
      onComplete();
      return;
    }
    const next = nextOnboardingStep({
      recovery: !!data.recovery_acknowledged_at,
      profile: !!data.profile_completed_at,
      country: !!data.country_handled_at,
      interests: !!data.interests_handled_at,
    });
    if (next === "complete") {
      onComplete();
      return;
    }
    setStep(next);
  }

  return (
    <>
      {step === "recovery" && (
        <RecoveryCeremony
          username={profile.username}
          error={error}
          onContinue={async () => {
            const { error: rpcError } = await supabase!.rpc(
              "acknowledge_recovery",
            );
            if (rpcError) {
              setError("Something went wrong. Please try again.");
              return;
            }
            setError("");
            advance();
          }}
        />
      )}
      {step === "profile" && (
        <ProfileStep
          error={error}
          onContinue={async (displayName, bio) => {
            const { error: rpcError } = await supabase!.rpc("complete_profile", {
              new_display_name: displayName,
              new_bio: bio,
            });
            if (rpcError) {
              setError("Something went wrong. Please try again.");
              return;
            }
            setError("");
            advance();
          }}
        />
      )}
      {step === "country" && (
        <CountryStep
          error={error}
          onContinue={async () => {
            const { error: rpcError } = await supabase!.rpc("handle_country");
            if (rpcError) {
              setError("Something went wrong. Please try again.");
              return;
            }
            setError("");
            advance();
          }}
        />
      )}
      {step === "interests" && (
        <InterestsStep
          error={error}
          onContinue={async (slugs) => {
            const { error: rpcError } = await supabase!.rpc(
              "set_onboarding_interests",
              { selected_slugs: slugs },
            );
            if (rpcError) {
              setError("Something went wrong. Please try again.");
              return;
            }
            const { error: completeError } = await supabase!.rpc(
              "complete_onboarding",
            );
            if (completeError) {
              setError("Something went wrong. Please try again.");
              return;
            }
            onComplete();
          }}
        />
      )}
    </>
  );
}
