import type { SupabaseClient } from "@supabase/supabase-js";

const TERMINAL_MATCH_STATUSES = new Set([
  "completed",
  "walkover",
  "void",
  "cancelled",
]);

const WINNER_FEEDER_STATUSES = new Set(["completed", "walkover"]);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_MATCH_STATUSES.has(status);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Completes the tournament when a final slot (next_match_id IS NULL) is terminal.
 */
export async function maybeCompleteTournament(
  admin: SupabaseClient,
  tournamentId: string
): Promise<boolean> {
  const { data: tournament, error: tournamentError } = await admin
    .from("tournaments")
    .select("id, status")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError || !tournament || tournament.status !== "in_progress") {
    return false;
  }

  const { data: finals, error: finalError } = await admin
    .from("tournament_matches")
    .select("id, status, winner_entry_id, round_number")
    .eq("tournament_id", tournamentId)
    .is("next_match_id", null);

  if (finalError || !finals?.length) {
    return false;
  }

  const terminalFinals = finals.filter((row) => isTerminalStatus(row.status));

  if (terminalFinals.length === 0) {
    return false;
  }

  const finalMatch = [...terminalFinals].sort(
    (a, b) => b.round_number - a.round_number
  )[0];

  const completedAt = nowIso();

  if (finalMatch.status === "void") {
    const { data: updated, error: updateError } = await admin
      .from("tournaments")
      .update({
        status: "completed",
        winner_id: null,
        updated_at: completedAt,
      })
      .eq("id", tournamentId)
      .eq("status", "in_progress")
      .select("id")
      .maybeSingle();

    return Boolean(updated) && !updateError;
  }

  if (
    WINNER_FEEDER_STATUSES.has(finalMatch.status) &&
    finalMatch.winner_entry_id
  ) {
    const { data: entry, error: entryError } = await admin
      .from("tournament_entries")
      .select("user_id")
      .eq("id", finalMatch.winner_entry_id)
      .maybeSingle();

    if (entryError || !entry?.user_id) {
      return false;
    }

    const { data: updated, error: updateError } = await admin
      .from("tournaments")
      .update({
        status: "completed",
        winner_id: entry.user_id,
        updated_at: completedAt,
      })
      .eq("id", tournamentId)
      .eq("status", "in_progress")
      .select("id")
      .maybeSingle();

    return Boolean(updated) && !updateError;
  }

  return false;
}

/**
 * Idempotent repair: propagate bracket state then complete if final is terminal.
 */
export async function reconcileTournamentCompletion(
  admin: SupabaseClient,
  tournamentId: string
): Promise<boolean> {
  const { data: tournament, error: tournamentError } = await admin
    .from("tournaments")
    .select("id, status")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError || !tournament || tournament.status !== "in_progress") {
    return false;
  }

  return maybeCompleteTournament(admin, tournamentId);
}
