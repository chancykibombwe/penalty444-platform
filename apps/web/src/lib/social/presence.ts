/**
 * Phase 9 — Derived presence states.
 *
 * No real online presence is tracked yet (would require socket/heartbeat
 * infrastructure we explicitly aren't building in this phase). Instead we
 * derive an honest, low-claim status from data the platform already
 * knows about each player:
 *
 *   - In a tournament right now             → "Competing"
 *   - Currently in a live (room) match       → "Competing"
 *   - Has matches but matches < 10            → "Placement"
 *   - Matches ≥ 10 + recent match this week   → "Active recently"
 *   - Matches ≥ 10 with no recent match       → "Ranked"
 *   - Anything else (0 matches)               → "Newcomer"
 *
 * Callers should treat the result as DISPLAY ONLY — there is no real-time
 * accuracy guarantee. We never claim a player is "Online" because we
 * cannot verify it.
 */

export type PresenceState =
  | "competing"
  | "active-recently"
  | "in-tournament"
  | "placement"
  | "ranked"
  | "newcomer";

export type PresenceInput = {
  /** Total matches the player has on record. */
  matchesPlayed: number | null | undefined;
  /** Last completed match ISO timestamp, or null if unknown. */
  lastMatchAt?: string | null;
  /** True when DB shows player is in an active room or tournament match. */
  isInLiveMatch?: boolean;
  /** True when player has a non-terminal tournament entry. */
  isInTournament?: boolean;
};

const ACTIVE_WINDOW_MS = 7 * 86_400_000; // 7 days

export function derivePresence({
  matchesPlayed,
  lastMatchAt,
  isInLiveMatch,
  isInTournament,
}: PresenceInput): PresenceState {
  if (isInLiveMatch) return "competing";
  if (isInTournament) return "in-tournament";

  const matches = matchesPlayed ?? 0;
  if (matches === 0) return "newcomer";
  if (matches < 10) return "placement";

  const recent = isWithinWindow(lastMatchAt, ACTIVE_WINDOW_MS);
  return recent ? "active-recently" : "ranked";
}

function isWithinWindow(iso: string | null | undefined, windowMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < windowMs;
}

export const PRESENCE_LABEL: Record<PresenceState, string> = {
  competing: "Competing now",
  "in-tournament": "In tournament",
  "active-recently": "Active recently",
  placement: "Placement",
  ranked: "Ranked",
  newcomer: "Newcomer",
};

export const PRESENCE_TONE: Record<
  PresenceState,
  "cyan" | "amber" | "emerald" | "violet" | "neutral"
> = {
  competing: "cyan",
  "in-tournament": "amber",
  "active-recently": "emerald",
  placement: "violet",
  ranked: "neutral",
  newcomer: "neutral",
};
