/**
 * Phase 9 — Public player profile loader.
 *
 * Read-only resolver for `/profile/[username]`. Pulls everything the
 * existing competitive identity components need (stats, recent form,
 * tournament wins, achievements) from existing tables only:
 *
 *   - `player_stats`    → identity + stats + tier
 *   - `match_results`   → recent form, recent matches list
 *   - `tournaments`     → tournament wins count + latest crown
 *
 * Never writes. Never touches realtime / sockets / wallet. Safely returns
 * `null` if the username can't be resolved so the route can render the
 * "Competitor not found" empty state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveRecentForm,
  deriveStreak,
  type CompetitiveStats,
} from "../player/stats";

type FormOutcome = "W" | "L" | "D";

export type ProfileRecentMatch = {
  key: string;
  roomCode: string | null;
  matchType: string | null;
  result: "W" | "L" | "D";
  opponentUsername: string;
  opponentUserId: string | null;
  scoreFor: number;
  scoreAgainst: number;
  finishedAt: string | null;
  isTournament: boolean;
};

export type ProfileChampionTournament = {
  id: string;
  name: string;
  finishedAt: string | null;
};

export type PublicProfile = {
  userId: string;
  username: string;
  stats: CompetitiveStats;
  recentForm: FormOutcome[];
  recentMatches: ProfileRecentMatch[];
  championships: ProfileChampionTournament[];
};

type PlayerStatsRow = {
  user_id: string;
  username: string | null;
  matches: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  goals_for: number | null;
  goals_against: number | null;
  rank_points: number | null;
  tier: string | null;
};

type MatchResultRow = {
  room_code: string | null;
  match_type: string | null;
  player_one_id: string | null;
  player_one_username: string | null;
  player_one_score: number | null;
  player_two_id: string | null;
  player_two_username: string | null;
  player_two_score: number | null;
  winner_id: string | null;
  is_draw: boolean | null;
  created_at: string | null;
};

type TournamentChampRow = {
  id: string;
  name: string | null;
  updated_at: string | null;
};

const RECENT_MATCH_LIMIT = 10;
const RECENT_FORM_LIMIT = 5;

/**
 * Resolve a username to its canonical `player_stats` row (case-insensitive
 * exact match). Returns `null` if no such player exists.
 */
export async function resolveUsernameToStats(
  client: SupabaseClient,
  rawUsername: string
): Promise<PlayerStatsRow | null> {
  const username = rawUsername.trim();
  if (!username) return null;

  try {
    const result = await client
      .from("player_stats")
      .select(
        "user_id, username, matches, wins, losses, draws, goals_for, goals_against, rank_points, tier"
      )
      .eq("game_id", "penalty444")
      .ilike("username", username)
      .maybeSingle();
    return (result.data ?? null) as PlayerStatsRow | null;
  } catch {
    return null;
  }
}

/**
 * Fetch the full public profile for a username. Returns `null` only when
 * the player can't be resolved — other failures degrade gracefully into
 * partial / empty fields.
 */
export async function fetchPublicProfile(
  client: SupabaseClient,
  rawUsername: string
): Promise<PublicProfile | null> {
  const statsRow = await resolveUsernameToStats(client, rawUsername);
  if (!statsRow) return null;

  const userId = statsRow.user_id;
  const username = (statsRow.username ?? rawUsername).trim();

  // Recent matches + tournament wins in parallel. We over-fetch matches to
  // build BOTH `recentForm` (last 5) and `recentMatches` (last 10).
  const [matchesResult, tournamentsResult] = await Promise.all([
    client
      .from("match_results")
      .select(
        "room_code, match_type, player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, is_draw, created_at"
      )
      .or(`player_one_id.eq.${userId},player_two_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(RECENT_MATCH_LIMIT),
    client
      .from("tournaments")
      .select("id, name, updated_at")
      .eq("game_id", "penalty444")
      .eq("status", "completed")
      .eq("winner_id", userId)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const matchRows = (matchesResult.data ?? []) as MatchResultRow[];
  const championRows = (tournamentsResult.data ?? []) as TournamentChampRow[];

  const recentForm = deriveRecentForm(
    matchRows,
    userId,
    RECENT_FORM_LIMIT
  ) as FormOutcome[];
  const streak = deriveStreak(recentForm);
  const tournamentWins = championRows.length;

  const recentMatches = matchRows.map((row): ProfileRecentMatch => {
    const isP1 = row.player_one_id === userId;
    const opponentId = isP1 ? row.player_two_id : row.player_one_id;
    const opponentName =
      (isP1 ? row.player_two_username : row.player_one_username) ?? "Opponent";
    const scoreFor = (isP1 ? row.player_one_score : row.player_two_score) ?? 0;
    const scoreAgainst =
      (isP1 ? row.player_two_score : row.player_one_score) ?? 0;
    const draw = row.is_draw === true;
    const result: ProfileRecentMatch["result"] = draw
      ? "D"
      : row.winner_id === userId
        ? "W"
        : "L";

    return {
      key: `${row.room_code ?? "x"}:${row.created_at ?? ""}`,
      roomCode: row.room_code,
      matchType: row.match_type,
      result,
      opponentUsername: (opponentName ?? "").trim() || "Opponent",
      opponentUserId: opponentId,
      scoreFor,
      scoreAgainst,
      finishedAt: row.created_at,
      isTournament: row.match_type === "tournament",
    };
  });

  const stats: CompetitiveStats = {
    username,
    rating: statsRow.rank_points ?? null,
    matches: statsRow.matches ?? 0,
    wins: statsRow.wins ?? 0,
    losses: statsRow.losses ?? 0,
    draws: statsRow.draws ?? 0,
    goalsFor: statsRow.goals_for ?? 0,
    goalsAgainst: statsRow.goals_against ?? 0,
    tournamentWins,
    legacyTierName: statsRow.tier ?? null,
    recentForm,
    streak,
  };

  return {
    userId,
    username,
    stats,
    recentForm,
    recentMatches,
    championships: championRows.map((row) => ({
      id: row.id,
      name: (row.name ?? "Tournament").trim() || "Tournament",
      finishedAt: row.updated_at,
    })),
  };
}
