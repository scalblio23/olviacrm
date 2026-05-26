/**
 * Normalize a phone number to E.164, defaulting to Australia (+61).
 * Returns the E.164 string (e.g. "+61434869538") or null when the input
 * cannot be normalized (empty, contains letters, too short, unknown shape).
 *
 * No multi-country auto-detection: bare numbers are always assumed Australian.
 * Numbers already written with a leading "+" are treated as explicit
 * international numbers and kept as-is (whitespace/dashes stripped).
 *
 * Examples:
 *   "0434869538"      -> "+61434869538"  (local, leading 0)
 *   "434869538"       -> "+61434869538"  (bare subscriber, no 0/CC)
 *   "61434869538"     -> "+61434869538"  (country code, no +)
 *   "+61434869538"    -> "+61434869538"  (already E.164)
 *   "61 434 869 538"  -> "+61434869538"  (spacing/dashes stripped)
 *   "abc" / "" / "123"-> null            (invalid)
 */
const AU_CC = "61";

export function normalizeAuPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Letters mean it isn't a phone number (e.g. "N/A", "call mum").
  if (/[a-zA-Z]/.test(trimmed)) return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // Explicit international number — respect it, only sanity-check length.
  if (hadPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return "+" + digits;
  }

  // Australian local format: 0 + 9 subscriber digits.
  if (digits.startsWith("0") && digits.length === 10) return "+" + AU_CC + digits.slice(1);
  // Country code without "+": 61 + 9 subscriber digits.
  if (digits.startsWith(AU_CC) && digits.length === 11) return "+" + digits;
  // Bare subscriber number (no leading 0 or country code) — assume Australian.
  if (digits.length === 9) return "+" + AU_CC + digits;

  return null;
}
