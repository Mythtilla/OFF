export type OnboardingProgress = {
  steps: { id: string; label: string; done: boolean }[];
  current: string | null;
  percent: number;
};

const LABELS: [string, string][] = [
  ["recovery", "Recovery"],
  ["profile", "Profile"],
];

export function onboardingProgress(state: {
  recovery_acknowledged_at: string | null;
  profile_completed_at: string | null;
}): OnboardingProgress {
  const flags = [
    state.recovery_acknowledged_at,
    state.profile_completed_at,
  ];
  const done = flags.map((value) => value !== null);
  const steps = LABELS.map(([id, label], index) => ({
    id,
    label,
    done: done[index],
  }));
  const firstUndone = done.findIndex((value) => !value);
  const doneCount = done.filter(Boolean).length;
  return {
    steps,
    current: firstUndone === -1 ? null : LABELS[firstUndone][0],
    percent: Math.round((doneCount / LABELS.length) * 100),
  };
}