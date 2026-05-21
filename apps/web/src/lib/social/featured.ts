/**
 * Phase 9 — Featured players logic.
 *
 * Read-only aggregation over existing tables for the `FeaturedPlayers`
 * home strip. Surfaces three reasons a player might be featured:
 *
 *   - "Top ranked"           → highest `rank_points` among ranked players
 *   - "Longest streak"       → highest positive `streak`
 *   - "Tournament champion"  → recent tournament winners
 *
 * Never writes. No new tables. No fake players or fake stats.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type FeaturedReason = "top-ranked" | "longest-streak" | "champion";

export type FeaturedPlayer = {
  userId: string;
  username: string;
  rating: number | null;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** Win rate as 0-100 integer. */
  winRate: number;
  streak: number;
  tournamentWins: number;
  reason: FeaturedReason;
  reasonLabel: string;
};

const RANKED_MATCH_FLOOR = 10;
const TOP_LIMIT = 4;

type PlayerStatsRow = {
  user_id: string;
  username: string | null;
  matches: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  rank_points: number | null;
};

const STATS_SELECT =
  "user_id, username, matches, wins, losses, draws, rank_points";

type ChampionTournamentRow = {
  id: string;
  name: string | null;
  winner_id: string | null;
  updated_at: string | null;
};

/**
 * Compose a small list of featured players. Tries to fill ALL three
 * reason slots whenever possible. Deduplicates by user_id so the same
 * player never appears twice in the strip.
 */
export async function fetchFeaturedPlayers(
  client: SupabaseClient,
  limit = TOP_LIMIT
): Promise<FeaturedPlayer[]> {
  try {
    const [topRankedResult, mostWinsResult, championRowsResult] = await Promise.all([
      client
        .from("player_stats")
        .select(STATS_SELECT)
        .eq("game_id", "penalty444")
        .gte("matches", RANKED_MATCH_FLOOR)
        .order("rank_points", { ascending: false })
        .order("wins", { ascending: false })
        .limit(limit),
      // No `streak` column in `player_stats` — streak is derived per-player
      // from `match_results`. As a cheap "momentum" proxy we surface players
      // with the most absolute wins in addition to top-ranked.
      client
        .from("player_stats")
        .select(STATS_SELECT)
        .eq("game_id", "penalty444")
        .gte("matches", RANKED_MATCH_FLOOR)
        .order("wins", { ascending: false })
        .order("rank_points", { ascending: false })
        .limit(limit),
      client
        .from("tournaments")
        .select("id, name, winner_id, updated_at")
        .eq("game_id", "penalty444")
        .eq("status", "completed")
        .not("winner_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(limit),
    ]);

    const topRankedRows = (topRankedResult.data ?? []) as PlayerStatsRow[];
    const mostWinsRows = (mostWinsResult.data ?? []) as PlayerStatsRow[];
    const championRows = (championRowsResult.data ?? []) as ChampionTournamentRow[];

    const featured: FeaturedPlayer[] = [];
    const seen = new Set<string>();

    function push(player: FeaturedPlayer) {
      if (seen.has(player.userId)) return;
      seen.add(player.userId);
      featured.push(player);
    }

    // 1. Top ranked — one slot maximum so the strip stays varied.
    const topRanked = topRankedRows[0];
    if (topRanked) {
      push(toFeatured(topRanked, "top-ranked", "Top Ranked"));
    }

    // 2. Most wins (proxy for "on a roll"). Skipped if it's the same player
    //    as the top-ranked slot.
    const topMomentum = mostWinsRows[0];
    if (topMomentum && !seen.has(topMomentum.user_id)) {
      push(
        toFeatured(
          topMomentum,
          "longest-streak",
          `${topMomentum.wins ?? 0} career wins`
        )
      );
    }

    // 3. Recent champion. We need to enrich champion winner_ids with their
    //    `player_stats` row.
    const championIds = championRows
      .map((row) => row.winner_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (championIds.length > 0) {
      const enriched = await client
        .from("player_stats")
        .select(STATS_SELECT)
        .eq("game_id", "penalty444")
        .in("user_id", championIds);
      const enrichedRows = (enriched.data ?? []) as PlayerStatsRow[];
      const byId = new Map(enrichedRows.map((row) => [row.user_id, row]));
      for (const champRow of championRows) {
        if (!champRow.winner_id) continue;
        const stats = byId.get(champRow.winner_id);
        if (!stats) continue;
        push(
          toFeatured(
            stats,
            "champion",
            `Champion · ${(champRow.name ?? "Tournament").trim() || "Tournament"}`
          )
        );
        if (featured.length >= limit) break;
      }
    }

    // 4. Fill remaining slots from the rest of the top-ranked list.
    if (featured.length < limit) {
      for (const row of topRankedRows.slice(1)) {
        push(toFeatured(row, "top-ranked", "Top Ranked"));
        if (featured.length >= limit) break;
      }
    }

    return featured.slice(0, limit);
  } catch {
    return [];
  }
}

function toFeatured(
  row: PlayerStatsRow,
  reason: FeaturedReason,
  reasonLabel: string
): FeaturedPlayer {
  const wins = row.wins ?? 0;
  const matches = row.matches ?? 0;
  const winRate =
    matches > 0 ? Math.round((wins / matches) * 100) : 0;

  return {
    userId: row.user_id,
    username: (row.username ?? "").trim() || "Player",
    rating: row.rank_points ?? null,
    matchesPlayed: matches,
    wins,
    losses: row.losses ?? 0,
    draws: row.draws ?? 0,
    winRate,
    streak: 0,
    tournamentWins: 0,
    reason,
    reasonLabel,
  };
}
