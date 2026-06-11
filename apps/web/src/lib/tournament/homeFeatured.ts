/**
 * Phase 8B beta lock — Home tournament preview data.
 *
 * Read-only, frontend-only fetcher for the Home page "Tournament" spotlight.
 * Surfaces a single real, in-progress or upcoming public tournament with
 * counts derived from `tournament_entries` / `tournament_matches`. Returns
 * `null` when no such tournament exists so the UI can render a truthful
 * empty state instead of a fake fallback.
 *
 * This module never writes, mutates, or touches bracket/advancement logic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type HomeFeaturedTournament = {
  id: string;
  name: string;
  status: string;
  startsAtIso: string | null;
  playersCount: number;
  liveMatches: number;
  currentRound: number | null;
};

export async function fetchHomeFeaturedTournament(
  client: SupabaseClient
): Promise<HomeFeaturedTournament | null> {
  const { data: tournaments, error } = await client
    .from("tournaments")
    .select("id, name, status, starts_at")
    .eq("game_id", "penalty444")
    .in("status", ["in_progress", "check_in", "registration"])
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(10);

  if (error || !tournaments || tournaments.length === 0) return null;

  const tournament =
    tournaments.find((row) => row.status === "in_progress") ?? tournaments[0];

  const [entriesResult, matchesResult] = await Promise.all([
    client
      .from("tournament_entries")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournament.id),
    tournament.status === "in_progress"
      ? client
          .from("tournament_matches")
          .select("round_number")
          .eq("tournament_id", tournament.id)
          .eq("status", "in_progress")
      : Promise.resolve({ data: [] as Array<{ round_number: number }> }),
  ]);

  const liveRows = matchesResult.data ?? [];

  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    startsAtIso: tournament.starts_at,
    playersCount: entriesResult.count ?? 0,
    liveMatches: liveRows.length,
    currentRound:
      liveRows.length > 0
        ? Math.max(...liveRows.map((row) => row.round_number))
        : null,
  };
}
