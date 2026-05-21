/**
 * Phase 5 — shared player stat helpers. UI-only — no DB writes.
 *
 * Acts as the lightweight presentation layer between raw `player_stats` rows
 * and competitive identity components. Designed so a future MMR/ranked
 * service can drop in by replacing the `loadPlayerStats` query.
 */

import { getRankTier, type RankTier } from "./ranks";

/**
 * Generic stats shape the identity components consume. Mirrors the Supabase
 * `player_stats` row but with all fields optional so partially-loaded data
 * still renders safely.
 */
export type CompetitiveStats = {
  username?: string | null;
  rating?: number | null;
  wins?: number | null;
  losses?: number | null;
  draws?: number | null;
  matches?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  tournamentWins?: number | null;
  /** Positive = win streak, negative = loss streak. */
  streak?: number | null;
  /** Last N match outcomes, most-recent first. */
  recentForm?: ReadonlyArray<"W" | "L" | "D"> | null;
  /** Legacy DB tier string (e.g. "Bronze", "Legend"). Optional fallback. */
  legacyTierName?: string | null;
};

/**
 * Returns a [0, 100] integer win-rate. Returns 0 when match count is 0/null
 * — callers should usually decorate with a "Play X matches to qualify"
 * fallback instead of showing the literal "0%" with no context.
 */
export function formatWinRate(
  wins: number | null | undefined,
  matches: number | null | undefined
): number {
  if (!matches || matches <= 0) return 0;
  const w = wins ?? 0;
  return Math.round((w / matches) * 100);
}

/**
 * Returns a short, presentation-ready streak string:
 *   - "W3" / "L2" when streak is a numeric run
 *   - "—" when there is no streak / no data
 */
export function formatStreakLabel(streak: number | null | undefined): string {
  if (!streak || streak === 0) return "—";
  const prefix = streak > 0 ? "W" : "L";
  return `${prefix}${Math.abs(streak)}`;
}

/**
 * Returns a one-line "form" label (e.g. "W W L W —") for the last 5 matches.
 * Falls back to "—" when recent form is missing.
 */
export function formatRecentFormLabel(
  form: ReadonlyArray<"W" | "L" | "D"> | null | undefined,
  maxLength = 5
): string {
  if (!form || form.length === 0) return "—";
  return form.slice(0, maxLength).join(" ");
}

/**
 * Returns true when we have enough data to consider the player "ranked".
 * Used to gate competitive UI ("Placement Matches X / 10").
 *
 * Threshold mirrors `UNRANKED_MATCHES_THRESHOLD` in `ranks.ts` and
 * `PLACEMENT_MATCHES_REQUIRED` in `progression.ts`.
 */
export function isPlayerRanked(stats: CompetitiveStats | null | undefined): boolean {
  if (!stats) return false;
  const matches = stats.matches ?? 0;
  return matches >= 10;
}

/**
 * Convenience wrapper: returns the resolved RankTier plus the qualifying
 * matches-played gate so a component doesn't have to thread both manually.
 */
export function getCompetitiveTier(
  stats: CompetitiveStats | null | undefined
): RankTier {
  return getRankTier(stats?.rating ?? null, stats?.matches ?? null);
}

/**
 * Derive a `recentForm` array from raw match-result rows. Caller passes the
 * winner_id / is_draw shape from `match_results`. Returns most-recent first.
 *
 * Display-only — drop-in for the Recent Form widget when matches are loaded.
 */
export function deriveRecentForm(
  matches: ReadonlyArray<{
    winner_id?: string | null;
    is_draw?: boolean | null;
  }>,
  myUserId: string,
  maxLength = 5
): Array<"W" | "L" | "D"> {
  const out: Array<"W" | "L" | "D"> = [];
  for (const m of matches) {
    if (out.length >= maxLength) break;
    if (m.is_draw) out.push("D");
    else if (m.winner_id && m.winner_id === myUserId) out.push("W");
    else out.push("L");
  }
  return out;
}

/**
 * Derive the current streak (positive = wins, negative = losses) from a
 * recent-form array. Draws break a streak.
 */
export function deriveStreak(
  form: ReadonlyArray<"W" | "L" | "D"> | null | undefined
): number {
  if (!form || form.length === 0) return 0;
  const head = form[0];
  if (head === "D") return 0;
  let count = 0;
  for (const r of form) {
    if (r === head) count += 1;
    else break;
  }
  return head === "W" ? count : -count;
}
