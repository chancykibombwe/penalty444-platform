"use client";

/**
 * Home desktop leaderboard preview — read-only helper.
 *
 * Reads the existing public-read `public.player_stats` table and mirrors the
 * ordering used by the full Leaderboard page (rank_points → wins → matches →
 * goals_for). Nothing here writes, mutates, or touches gameplay, progression,
 * settlement, or wallet logic. On any error it returns an empty list so the
 * Home panel can fall back to a safe branded empty state — never fake players.
 */

import { supabase } from "../supabase/client";
import { UNRANKED_MATCHES_THRESHOLD } from "../player/ranks";

export type TopPlayer = {
  id: string;
  rank: number;
  username: string;
  wins: number;
  losses: number;
  matches: number;
  rankPoints: number;
  /** true when matches < UNRANKED_MATCHES_THRESHOLD (still in placement). */
  provisional: boolean;
};

type PlayerStatsRow = {
  user_id: string;
  username: string | null;
  wins: number | null;
  losses: number | null;
  matches: number | null;
  rank_points: number | null;
};

/**
 * Fetch the top N players by rank points. Includes players with at least one
 * completed match so an early-beta board is never empty for no reason;
 * players still in placement (< threshold matches) are flagged `provisional`
 * so the UI can label them honestly.
 */
export async function fetchTopPlayers(limit = 5): Promise<TopPlayer[]> {
  try {
    const { data, error } = await supabase
      .from("player_stats")
      .select("user_id, username, wins, losses, matches, rank_points")
      .eq("game_id", "penalty444")
      .gt("matches", 0)
      .order("rank_points", { ascending: false })
      .order("wins", { ascending: false })
      .order("matches", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return (data as PlayerStatsRow[]).map((row, index) => ({
      id: row.user_id,
      rank: index + 1,
      username: (row.username ?? "").trim() || "Player",
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      matches: row.matches ?? 0,
      rankPoints: row.rank_points ?? 0,
      provisional: (row.matches ?? 0) < UNRANKED_MATCHES_THRESHOLD,
    }));
  } catch {
    return [];
  }
}
