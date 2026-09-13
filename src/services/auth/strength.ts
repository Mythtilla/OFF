export type PasswordLevel =
  | "too-short"
  | "weak"
  | "fair"
  | "strong"
  | "very-strong";

export const levelLabel: Record<PasswordLevel, string> = {
  "too-short": "Too short",
  weak: "Weak",
  fair: "Fair",
  strong: "Strong",
  "very-strong": "Very strong",
};

const common = new Set([
  "password",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "letmein",
  "iloveyou",
  "admin",
  "welcome",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "abc123",
  "111111",
  "000000",
  "123123",
  "password1",
  "passw0rd",
]);

export function passwordLevel(password: string): PasswordLevel {
  const len = password.length;
  if (len < 6) return "too-short";
  const lower = password.toLowerCase();
  if (common.has(lower)) return "weak";
  if (/^(.)\1+$/.test(password)) return "weak";
  let score = len >= 16 ? 3 : len >= 12 ? 2 : len >= 8 ? 1 : 0;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  if (score <= 1) return "weak";
  if (score === 2) return "fair";
  if (score === 3) return "strong";
  return len >= 12 ? "very-strong" : "strong";
}