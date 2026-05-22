/**
 * Phase 6 — Real Competitive Engine (server-side).
 *
 * Mirrors the formulas in `apps/web/src/lib/player/progression.ts`.
 * Keep both files in sync when changing constants.
 *
 * Called once per player after a `match_results` row is inserted. Updates
 * `player_stats` (read/write only — no schema changes).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Room } from "../types/room";
import type { ResolvedMatchOutcome } from "../gameplay/matchOutcome";

// ── Constants (sync with apps/web/src/lib/player/progression.ts) ──────────
export const PLACEMENT_MATCHES_REQUIRED = 10;
export const MIN_RATING = 0;
export const INITIAL_RATING_MAX = 1700;
export const CASUAL_WIN_DELTA = 25;
export const CASUAL_LOSS_DELTA = -20;
export const CASUAL_DRAW_DELTA = 3;
export const TOURNAMENT_SEMIFINAL_BONUS = 15;
export const TOURNAMENT_FINAL_BONUS = 35;
export const TOURNAMENT_CHAMPION_BONUS = 50;

type MatchKind = "casual" | "tournament";
type MatchOutcome = "win" | "loss" | "draw";

type TournamentRoundContext = {
  roundNumber: number;
  totalRounds: number;
  isFinal: boolean;
  isChampion: boolean;
};

type PlayerStatsRow = {
  user_id: string;
  username: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  goals_for: number;
  goals_against: number;
  rank_points: number;
  tier: string;
};

// ── Formulas ───────────────────────────────────────────────────────────────

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

function applyRankPointChange(currentRating: number, delta: number): number {
  const next = currentRating + delta;
  if (!Number.isFinite(next)) return Math.max(currentRating, MIN_RATING);
  return Math.max(MIN_RATING, next);
}

function calculateInitialPlacementRating(summary: {
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  streak: number;
}): number {
  const placementMatches = PLACEMENT_MATCHES_REQUIRED;
  const wins = Math.max(0, Math.min(summary.wins, placementMatches));
  const winRate = wins / placementMatches;
  const goalDiff = summary.goalsFor - summary.goalsAgainst;
  const goalDiffBonus = clamp(Math.round(goalDiff * 5), -150, 150);
  const streakBonus =
    summary.streak > 0 ? Math.min(summary.streak * 10, 50) : 0;

  let base: number;
  if (winRate >= 0.9) base = 1500;
  else if (winRate >= 0.7) base = 1100;
  else if (winRate >= 0.5) base = 700;
  else if (winRate >= 0.3) base = 300;
  else base = 100;

  return clamp(base + goalDiffBonus + streakBonus, MIN_RATING, INITIAL_RATING_MAX);
}

function ratingToTierName(rating: number): string {
  if (rating >= 3000) return "Champion";
  if (rating >= 2500) return "Elite";
  if (rating >= 2000) return "Diamond";
  if (rating >= 1500) return "Platinum";
  if (rating >= 1000) return "Gold";
  if (rating >= 500) return "Silver";
  return "Bronze";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Tournament context ─────────────────────────────────────────────────────

async function resolveTournamentContext(
  admin: SupabaseClient,
  room: Room,
  winnerUserId: string | null
): Promise<TournamentRoundContext | null> {
  if (room.matchType !== "tournament" || !room.tournamentMatchId) {
    return null;
  }

  const { data: slot, error: slotError } = await admin
    .from("tournament_matches")
    .select("id, tournament_id, round_number, next_match_id")
    .eq("id", room.tournamentMatchId)
    .maybeSingle();

  if (slotError || !slot) return null;

  const { data: rounds, error: roundsError } = await admin
    .from("tournament_matches")
    .select("round_number")
    .eq("tournament_id", slot.tournament_id);

  if (roundsError || !rounds?.length) return null;

  const totalRounds = Math.max(
    ...rounds.map((r) => Number(r.round_number) || 1)
  );
  const roundNumber = Number(slot.round_number) || 1;
  const isFinal = slot.next_match_id === null;
  // Champion bonus fires on the final-match win (same snapshot as the W).
  const isChampion = isFinal && Boolean(winnerUserId);

  return { roundNumber, totalRounds, isFinal, isChampion };
}

// ── Streak (derived from last 5 match_results — no DB column) ────────────

async function deriveStreakFromHistory(
  admin: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: rows } = await admin
    .from("match_results")
    .select("winner_id, is_draw")
    .or(`player_one_id.eq.${userId},player_two_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!rows?.length) return 0;

  const form: Array<"W" | "L" | "D"> = [];
  for (const row of rows) {
    if (row.is_draw) form.push("D");
    else if (row.winner_id === userId) form.push("W");
    else form.push("L");
  }

  if (form[0] === "D") return 0;
  const head = form[0];
  let count = 0;
  for (const r of form) {
    if (r === head) count += 1;
    else break;
  }
  return head === "W" ? count : -count;
}

// ── Per-player update ──────────────────────────────────────────────────────

function outcomeForPlayer(
  playerId: string,
  outcome: ResolvedMatchOutcome
): MatchOutcome {
  if (outcome.isDraw) return "draw";
  if (outcome.winner?.playerId === playerId) return "win";
  return "loss";
}

function goalsForPlayer(
  playerId: string,
  outcome: ResolvedMatchOutcome
): { scored: number; conceded: number } {
  const isFirst = outcome.firstPlayer.playerId === playerId;
  const scored = isFirst ? outcome.firstScore : outcome.secondScore;
  const conceded = isFirst ? outcome.secondScore : outcome.firstScore;
  return { scored, conceded };
}

async function loadOrCreateStats(
  admin: SupabaseClient,
  userId: string,
  username: string
): Promise<PlayerStatsRow> {
  const { data: existing } = await admin
    .from("player_stats")
    .select(
      "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points, tier"
    )
    .eq("game_id", "penalty444")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return existing as PlayerStatsRow;
  }

  const blank: PlayerStatsRow = {
    user_id: userId,
    username: username || "Player",
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    goals_for: 0,
    goals_against: 0,
    rank_points: 0,
    tier: "Placement",
  };

  const { error } = await admin.from("player_stats").insert({
    game_id: "penalty444",
    user_id: userId,
    username: blank.username,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    goals_for: 0,
    goals_against: 0,
    rank_points: 0,
    tier: "Placement",
  });

  if (error) {
    console.warn("[progression] insert player_stats failed:", error.message);
  }

  return blank;
}

async function applyProgressForPlayer(
  admin: SupabaseClient,
  userId: string,
  username: string,
  matchOutcome: MatchOutcome,
  goals: { scored: number; conceded: number },
  room: Room,
  tournamentCtx: TournamentRoundContext | null
): Promise<void> {
  const stats = await loadOrCreateStats(admin, userId, username);

  const prevMatches = stats.matches ?? 0;
  const wasInPlacement = prevMatches < PLACEMENT_MATCHES_REQUIRED;

  const nextMatches = prevMatches + 1;
  const nextWins = stats.wins + (matchOutcome === "win" ? 1 : 0);
  const nextLosses = stats.losses + (matchOutcome === "loss" ? 1 : 0);
  const nextDraws = stats.draws + (matchOutcome === "draw" ? 1 : 0);
  const nextGoalsFor = (stats.goals_for ?? 0) + goals.scored;
  const nextGoalsAgainst = (stats.goals_against ?? 0) + goals.conceded;

  const kind: MatchKind =
    room.matchType === "tournament" ? "tournament" : "casual";

  const isChampionForPlayer =
    tournamentCtx?.isChampion === true && matchOutcome === "win";

  const delta = calculateRankPointChange({
    kind,
    outcome: matchOutcome,
    tournament: tournamentCtx
      ? { ...tournamentCtx, isChampion: isChampionForPlayer }
      : null,
  });

  let nextRating = stats.rank_points ?? 0;
  let nextTier = stats.tier ?? "Placement";

  const justFinishedPlacement =
    wasInPlacement && nextMatches >= PLACEMENT_MATCHES_REQUIRED;

  if (justFinishedPlacement) {
    const streak = await deriveStreakFromHistory(admin, userId);
    nextRating = calculateInitialPlacementRating({
      wins: nextWins,
      losses: nextLosses,
      draws: nextDraws,
      goalsFor: nextGoalsFor,
      goalsAgainst: nextGoalsAgainst,
      streak,
    });
    nextTier = ratingToTierName(nextRating);
    console.info("[progression] placement complete", {
      userId,
      nextRating,
      nextTier,
      wins: nextWins,
      matches: nextMatches,
    });
  } else if (!wasInPlacement) {
    nextRating = applyRankPointChange(nextRating, delta);
    nextTier = ratingToTierName(nextRating);
  } else {
    // Still in placement — keep tier as Placement, rank_points at 0.
    nextRating = 0;
    nextTier = "Placement";
  }

  const { error: updateError } = await admin
    .from("player_stats")
    .update({
      username: username || stats.username,
      matches: nextMatches,
      wins: nextWins,
      losses: nextLosses,
      draws: nextDraws,
      goals_for: nextGoalsFor,
      goals_against: nextGoalsAgainst,
      rank_points: nextRating,
      tier: nextTier,
    })
    .eq("game_id", "penalty444")
    .eq("user_id", userId);

  if (updateError) {
    console.error("[progression] update player_stats failed:", updateError.message);
    return;
  }

  console.info("[progression] stats updated", {
    userId,
    matchOutcome,
    delta: wasInPlacement && !justFinishedPlacement ? 0 : delta,
    nextRating,
    nextTier,
    matches: nextMatches,
  });
}

/**
 * Apply competitive progression for both players after a saved match.
 * Safe to call after match_results insert; failures are logged, never thrown.
 *
 * Sprint 1 TASK 3: idempotent on the room object — flips
 * `room.progressionApplied` so a duplicate save path can never apply RP
 * twice for the same match instance.
 */
export async function applyPlayerProgressionFromMatch(
  admin: SupabaseClient,
  room: Room,
  outcome: ResolvedMatchOutcome
): Promise<void> {
  if (room.progressionApplied) {
    console.log(
      `[Progression] skipped duplicate roomCode=${room.code} instanceId=${room.matchInstanceId}`
    );
    return;
  }
  room.progressionApplied = true;

  const winnerId = outcome.winner?.playerId ?? null;

  // Champion flag may lag bracket completion — resolve after a short delay
  // is expensive; we re-fetch tournament winner_id when slot is final.
  const tournamentCtx = await resolveTournamentContext(
    admin,
    room,
    winnerId
  );

  const players = [
    {
      id: outcome.firstPlayer.playerId,
      username: outcome.firstPlayer.username,
    },
    {
      id: outcome.secondPlayer.playerId,
      username: outcome.secondPlayer.username,
    },
  ];

  for (const player of players) {
    const matchOutcome = outcomeForPlayer(player.id, outcome);
    const goals = goalsForPlayer(player.id, outcome);
    try {
      await applyProgressForPlayer(
        admin,
        player.id,
        player.username,
        matchOutcome,
        goals,
        room,
        tournamentCtx
      );
    } catch (err) {
      console.error("[progression] player update crashed:", player.id, err);
    }
  }

  console.log(
    `[Progression] applied roomCode=${room.code} instanceId=${room.matchInstanceId} matchType=${room.matchType}`
  );
}
