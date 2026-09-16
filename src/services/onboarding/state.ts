export type OnboardingStep = "recovery" | "profile" | "complete";
export function nextOnboardingStep(state: {
  recovery: boolean;
  profile: boolean;
}): OnboardingStep {
  if (!state.recovery) return "recovery";
  if (!state.profile) return "profile";
  return "complete";
}