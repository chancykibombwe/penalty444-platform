/**
 * Hardening Sprint 5 — TASK 4: safe secret masking helper.
 *
 * Use this anywhere a secret-shaped value MIGHT end up in a log line
 * (debug print, error message, JSON response). Replaces all but the
 * first / last two characters with `*` so a leak is still recognisable
 * for incident response without exposing material.
 *
 * Examples:
 *   maskSecret("abcd1234") → "ab****34"
 *   maskSecret("ab")       → "**"
 *   maskSecret(null)       → ""
 *   maskSecret("")         → ""
 *
 * Never include real secret values in JSON responses, even masked.
 * `/internal/economy/health` deliberately reports BOOLEAN `present` /
 * `missing` rather than calling this helper.
 */

export function maskSecret(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 4) {
    return "*".repeat(trimmed.length);
  }
  const head = trimmed.slice(0, 2);
  const tail = trimmed.slice(-2);
  const middle = "*".repeat(Math.max(4, trimmed.length - 4));
  return `${head}${middle}${tail}`;
}
