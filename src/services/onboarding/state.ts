export type OnboardingStep =
  | "recovery"
  | "profile"
  | "country"
  | "interests"
  | "complete";
export function nextOnboardingStep(state: {
  recovery: boolean;
  profile: boolean;
  country: boolean;
  interests: boolean;
}): OnboardingStep {
  if (!state.recovery) return "recovery";
  if (!state.profile) return "profile";
  if (!state.country) return "country";
  return state.interests ? "complete" : "interests";
}
