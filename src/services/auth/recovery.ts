/**
 * Recovery phrase binding. The phrase never leaves the user's clipboard/
 * client besides a single server-side call: OFF stores only a one-way bcrypt
 * verifier of a SHA-256 digest of the phrase (see migration 202609170002),
 * so the phrase itself is never persisted or retrievable.
 */
export const RECOVERY_WORD_COUNT = 24;
const words = [
  "amber",
  "anchor",
  "apple",
  "april",
  "arch",
  "atom",
  "birch",
  "blue",
  "bridge",
  "cabin",
  "candle",
  "cedar",
  "cloud",
  "coral",
  "dawn",
  "delta",
  "ember",
  "field",
  "flint",
  "forest",
  "harbor",
  "hazel",
  "island",
  "ivory",
  "juniper",
  "kite",
  "lantern",
  "maple",
  "meadow",
  "mercury",
  "moss",
  "north",
  "oasis",
  "olive",
  "orbit",
  "paper",
  "pearl",
  "pine",
  "quiet",
  "raven",
  "river",
  "sable",
  "saffron",
  "shore",
  "silver",
  "solace",
  "stone",
  "summit",
  "thistle",
  "timber",
  "valley",
  "violet",
  "willow",
  "winter",
];
export const recoveryNotice =
  "Your recovery phrase resets your password if you forget it. OFF stores only a one-way verifier — never the phrase itself — so keep it offline and never share it.";
export function recoveryPhraseValid(phrase: string) {
  const tokens = phrase.trim().split(/\s+/);
  return (
    tokens.length === RECOVERY_WORD_COUNT &&
    tokens.every((token) => /^[a-z]{2,10}$/.test(token))
  );
}
export function generateRecoveryPhrase(random: Crypto = crypto) {
  const bytes = new Uint32Array(RECOVERY_WORD_COUNT);
  random.getRandomValues(bytes);
  return Array.from(bytes, (value) => words[value % words.length]);
}
