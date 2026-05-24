/**
 * Hotfix Sprint — TASK 1: runtime validation for gameplay payloads.
 *
 * Background
 * ----------
 * The Sprint 6 deep audit surfaced a critical gameplay-integrity
 * exploit on `match:pick`: the realtime server accepted ANY value as
 * `lane` and assigned it directly to `room.picks[role]`. Because
 * `resolveShot` only checks lane EQUALITY, a malicious kicker could
 * emit `lane: "GUARANTEED_GOAL"` (a string the keeper can never
 * produce) and force a GOAL on every round.
 *
 * Defence
 * -------
 * Every gameplay payload that lands inside `room.picks` MUST flow
 * through `isValidLane()` before it touches state. The check is:
 *
 *   - Must be a JS string (rejects null, undefined, arrays, objects).
 *   - Must be EXACTLY one of `VALID_LANES` (`"LEFT" | "CENTER" | "RIGHT"`).
 *   - No lowercase, no whitespace, no aliases (`"L"`, `"left"`,
 *     `"left "`, `" LEFT"` are all rejected).
 *
 * The Lane string set is the canonical authority. Any future addition
 * (e.g. a new `"CENTER_LOW"` lane) must be added to `VALID_LANES`
 * here, in `apps/realtime-server/src/types/room.ts`, and in the
 * client `apps/web/src/components/match/matchPresentation.ts`. Three
 * sources of truth is intentional — it forces a code change in three
 * audited locations rather than letting the type system silently
 * accept "anything stringy".
 *
 * Logging
 * -------
 * The handler is responsible for logging the rejection. This module
 * exposes `summarizeForLog()` to safely truncate the rejected value
 * (so a 1 MB attacker payload can never blow up the log line).
 */

import type { Lane } from "../types/room";

export const VALID_LANES = ["LEFT", "CENTER", "RIGHT"] as const;

/**
 * Type-guard runtime validator for the `lane` field on `match:pick`.
 *
 * IMPORTANT: this is the ONLY function that should be used to narrow
 * an unknown wire payload to the `Lane` type. Do NOT use `as Lane` on
 * incoming socket payloads.
 */
export function isValidLane(value: unknown): value is Lane {
  if (typeof value !== "string") return false;
  // No `.trim()`, no `.toUpperCase()` — the legitimate client sends
  // exactly `"LEFT"` / `"CENTER"` / `"RIGHT"`. Anything else is a bug
  // or an attack and we reject loudly.
  return (VALID_LANES as readonly string[]).includes(value);
}

/**
 * Truncate an arbitrary value to a short, log-safe string. Caller
 * decides the prefix; this just guarantees the size and shape are
 * bounded so a hostile client can't blow up the log line.
 */
export function summarizeForLog(value: unknown, max = 32): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }
  if (t === "number" || t === "boolean") return String(value);
  if (Array.isArray(value)) return `array(len=${value.length})`;
  return `object`;
}
