/**
 * Phase 6 — Real Competitive Engine: rank point progression formulas.
 *
 * This module is the canonical, frontend-readable copy of the progression
 * rules. The realtime-server has a small mirror in
 * `apps/realtime-server/src/player/progression.ts` that must be kept in
 * sync — both files document the same constants at the top.
 *
 * The formulas are intentionally simple. Goals for this V1:
 *   - addictive climb (wins always feel rewarding)
 *   - losses sting, but never wipe a session
 *   - tournament wins are clearly more valuable than casuals
 *   - no negative spirals: rating is clamped at MIN_RATING
 *   - no instant champions: placements clamp at INITIAL_RATING_MAX
 */

import { getRankTier, type RankTier } from "./ranks";

/**
 * Number of matches that must be completed before a player escapes
 * placement and is shown a competitive rank tier.
 *
 * Keep in sync with `UNRANKED_MATCHES_THRESHOLD` in `ranks.ts` and
 * `PLACEMENT_MATCHES_REQUIRED` in the realtime-server progression mirror.
 */
export const PLACEMENT_MATCHES_REQUIRED = 10;

/** Lower bound for rank_points. Never go below this — no infinite negatives. */
export const MIN_RATING = 0;

/** Upper bound applied when a player exits placement. Caps instant promotion. */
export const INITIAL_RATING_MAX = 1700;

// Per-match deltas (casual / public / ranked / tournament-loss).
export const CASUAL_WIN_DELTA = 25;
export const CASUAL_LOSS_DELTA = -20;
export const CASUAL_DRAW_DELTA = 3;

// Tournament bonuses stacked on top of the casual win delta.
export const TOURNAMENT_SEMIFINAL_BONUS = 15;
export const TOURNAMENT_FINAL_BONUS = 35;
export const TOURNAMENT_CHAMPION_BONUS = 50;

export type MatchKind = "casual" | "tournament";
export type MatchOutcome = "win" | "loss" | "draw";

export type TournamentRoundContext = {
  /** 1-indexed bracket round (round 1 = first round of play). */
  roundNumber: number;
  /** Total bracket rounds (e.g. 3 for an 8-player single-elim). */
  totalRounds: number;
  /** True when this is the championship match. */
  isFinal: boolean;
  /** True when the winning player has just won the tournament. */
  isChampion: boolean;
};

/**
 * Returns the rank-point change for a single match outcome.
 *
 * Casual matches always use the flat deltas. Tournament matches add stacking
 * bonuses for semifinal / final / champion. Tournament losses use the same
 * casual loss delta — losing in a tournament shouldn't be doubly punishing.
 */
export function calculateRankPointChange(input: {
  kind: MatchKind;
  outcome: MatchOutcome;
  tournament?: TournamentRoundContext | null;
}): number {
  const { kind, outcome, tournament } = input;

  if (outcome === "draw") return CASUAL_DRAW_DELTA;
  if (outcome === "loss") return CASUAL_LOSS_DELTA;

  let delta = CASUAL_WIN_DELTA;

  if (kind === "tournament" && tournament) {
    const isSemifinal =
      tournament.totalRounds > 1 &&
      tournament.totalRounds - tournament.roundNumber === 1 &&
      !tournament.isFinal;

    if (isSemifinal) delta += TOURNAMENT_SEMIFINAL_BONUS;
    if (tournament.isFinal) delta += TOURNAMENT_FINAL_BONUS;
    if (tournament.isChampion) delta += TOURNAMENT_CHAMPION_BONUS;
  }

  return delta;
}

/**
 * Apply a rank delta with safety clamps. Rating never goes below MIN_RATING.
 * Returns the *new* rating.
 */
export function applyRankPointChange(
  currentRating: number,
  delta: number
): number {
  const next = currentRating + delta;
  if (!Number.isFinite(next)) return Math.max(currentRating, MIN_RATING);
  return Math.max(MIN_RATING, next);
}

export type PlacementSummary = {
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Positive: win streak. Negative: loss streak. Zero: none. */
  streak: number;
};

/**
 * Initial competitive rating after a player completes placements.
 *
 * Inputs:
 *   - wins / losses / draws over the 10 placement matches
 *   - goal differential
 *   - current streak at the end of placements
 *
 * Output: integer rating capped at INITIAL_RATING_MAX so a hot placement
 * run cannot drop someone straight into Diamond / Elite / Champion.
 */
export function calculateInitialPlacementRating(
  summary: PlacementSummary
): number {
  const placementMatches = PLACEMENT_MATCHES_REQUIRED;
  const wins = Math.max(0, Math.min(summary.wins, placementMatches));
  const winRate = wins / placementMatches;

  const goalDiff = summary.goalsFor - summary.goalsAgainst;
  const goalDiffBonus = clamp(Math.round(goalDiff * 5), -150, 150);

  const streakBonus =
    summary.streak > 0 ? Math.min(summary.streak * 10, 50) : 0;

  // Base rating: anchored to win-rate. Hot run lands mid-Platinum at the
  // very most (1500 base + up to 200 from goal diff/streak = 1700 ceiling).
  let base: number;
  if (winRate >= 0.9) base = 1500;
  else if (winRate >= 0.7) base = 1100;
  else if (winRate >= 0.5) base = 700;
  else if (winRate >= 0.3) base = 300;
  else base = 100;

  return clamp(base + goalDiffBonus + streakBonus, MIN_RATING, INITIAL_RATING_MAX);
}

/**
 * Map a numeric rating to the DB `player_stats.tier` string. Keeps the legacy
 * column populated with the canonical labels even while the UI reads from
 * the numeric rating.
 */
export function ratingToTierName(rating: number | null | undefined): string {
  const tier = getRankTier(rating);
  return tier.label;
}

/**
 * Returns the placement-phase status for a player. Used by the UI and the
 * progression engine to gate competitive presentation.
 */
export function getPlacementStatus(matchesPlayed: number | null | undefined): {
  inPlacement: boolean;
  played: number;
  remaining: number;
  required: number;
  label: string;
} {
  const played = Math.max(0, matchesPlayed ?? 0);
  const required = PLACEMENT_MATCHES_REQUIRED;
  const inPlacement = played < required;
  return {
    inPlacement,
    played: Math.min(played, required),
    remaining: Math.max(0, required - played),
    required,
    label: inPlacement
      ? `Placement Matches ${Math.min(played, required)} / ${required}`
      : "Ranked",
  };
}

/**
 * Convenience: presentational tier from a rating, hiding it when the player
 * is still in placements. Returns `null` for placement players so callers
 * can render the placement label instead of a tier badge.
 */
export function getPresentationalTier(
  rating: number | null | undefined,
  matchesPlayed: number | null | undefined
): RankTier | null {
  if (
    matchesPlayed !== null &&
    matchesPlayed !== undefined &&
    matchesPlayed < PLACEMENT_MATCHES_REQUIRED
  ) {
    return null;
  }
  return getRankTier(rating, matchesPlayed);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
