import type { TournamentMatchRow } from "../../components/tournament/TournamentBracketPanel";
import type {
  TournamentEntryRow,
  TournamentRow,
} from "../../components/tournament/TournamentListPanel";
import { getCurrentPlayerIdentity } from "../auth/playerIdentity";
import { supabase } from "../supabase/client";

export type TournamentDetailRow = TournamentRow & {
  winner_id: string | null;
};

export type TournamentDetailFetchResult =
  | {
      ok: true;
      tournament: TournamentDetailRow;
      entries: TournamentEntryRow[];
      matches: TournamentMatchRow[];
      creatorUsername: string | null;
      currentUserId: string | null;
    }
  | {
      ok: false;
      error: string;
    };

export async function fetchTournamentDetail(
  tournamentId: string
): Promise<TournamentDetailFetchResult> {
  if (!tournamentId) {
    return { ok: false, error: "Missing tournament id." };
  }

  const identity = await getCurrentPlayerIdentity();

  const { data: tournamentRow, error: tournamentError } = await supabase
    .from("tournaments")
    .select(
      "id, game_id, name, status, format, max_players, rounds_per_match, created_by, starts_at, created_at, winner_id"
    )
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError) {
    return { ok: false, error: tournamentError.message };
  }

  if (!tournamentRow) {
    return { ok: false, error: "Tournament not found." };
  }

  const [entriesResult, matchesResult] = await Promise.all([
    supabase
      .from("tournament_entries")
      .select("id, tournament_id, user_id, username, status, checked_in_at")
      .eq("tournament_id", tournamentId)
      .order("checked_in_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("tournament_matches")
      .select(
        "id, tournament_id, round_number, slot_index, entry_one_id, entry_two_id, room_code, status, winner_entry_id, next_match_id"
      )
      .eq("tournament_id", tournamentId)
      .order("round_number", { ascending: true })
      .order("slot_index", { ascending: true }),
  ]);

  if (entriesResult.error) {
    return { ok: false, error: entriesResult.error.message };
  }

  if (matchesResult.error) {
    return { ok: false, error: matchesResult.error.message };
  }

  const tournament = tournamentRow as TournamentDetailRow;
  const currentUserId = identity?.playerId ?? null;

  let creatorUsername: string | null = null;
  const isViewerHost =
    currentUserId != null && currentUserId === tournament.created_by;

  if (!isViewerHost) {
    const { data: creatorProfile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", tournament.created_by)
      .maybeSingle();
    creatorUsername = creatorProfile?.username ?? null;
  }

  return {
    ok: true,
    tournament,
    entries: (entriesResult.data ?? []) as TournamentEntryRow[],
    matches: (matchesResult.data ?? []) as TournamentMatchRow[],
    creatorUsername,
    currentUserId,
  };
}
