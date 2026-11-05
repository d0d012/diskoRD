/**
 * Discord-style channel name normalization shared by create and rename.
 *
 * - lowercases (locale-independent: "İ".toLowerCase() yields "i" + a combining
 *   dot, which the character filter below drops, so Turkish "İSTANBUL" becomes
 *   "istanbul"; "I" -> "i", "ı" -> "ı")
 * - whitespace runs become single hyphens
 * - only Unicode letters/numbers and hyphens survive, so ç ğ ı İ ö ş ü are kept
 *   while punctuation and emoji are stripped
 * - repeated hyphens collapse
 */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-{2,}/g, "-");
}

/** Final channel name: no surrounding whitespace or hyphens. */
export function normalizeChannelName(raw: string): string {
  return slugify(raw.trim()).replace(/^-+|-+$/g, "");
}

/**
 * Variant for controlled inputs: keeps a trailing hyphen so typing a space does
 * not get swallowed (the final name is normalized again on submit).
 */
export function normalizeChannelNameInput(raw: string): string {
  return slugify(raw).replace(/^-+/, "");
}
