import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bracketSlotKey,
  generateBracketWithByes,
  getParentSlot,
  getTotalRounds,
} from "@/lib/tournament/bracket";
import { computePlayBy } from "@/lib/tournament/deadlines";

export type StartTournamentSource = "manual" | "scheduled";

const ALLOWED_START_STATUSES = ["registration", "check_in"] as const;

export type StartTournamentParams = {
  tournamentId: string;
  requestedByUserId: string;
  requireCreator: boolean;
  source: StartTournamentSource;
  admin?: SupabaseClient;
};

export type StartTournamentSuccess = {
  ok: true;
  tournamentId: string;
  matchCount: number;
  playerCount: number;
};

export type StartTournamentFailure = {
  ok: false;
  status: number;
  error: string;
  rollbackFailed?: boolean;
  detail?: string;
};

export type StartTournamentResult =
  | StartTournamentSuccess
  | StartTournamentFailure;

async function rollbackTournamentBracket(
  admin: SupabaseClient,
  tournamentId: string,
  source: StartTournamentSource
): Promise<void> {
  const { error } = await admin
    .from("tournament_matches")
    .delete()
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error(
      `[tournament start:${source}] bracket rollback failed for ${tournamentId}:`,
      error.message
    );
    throw new Error(error.message);
  }
}

/** Placeholder user id for scheduled/cron starts (authorization skipped when requireCreator is false). */
export const TOURNAMENT_START_SYSTEM_USER_ID = "system";

/**
 * Creates the bracket and moves the tournament to in_progress.
 * Seeds all non-withdrawn entries with status registered or checked_in.
 * Ready (checked_in) is informational only for seed order tie-breaking.
 * When requireCreator is false, requestedByUserId is audit-only (e.g. "system").
 */
export async function startTournament({
  tournamentId,
  requestedByUserId,
  requireCreator,
  source,
  admin: adminClient,
}: StartTournamentParams): Promise<StartTournamentResult> {
  const admin = adminClient ?? createAdminClient();
  const logPrefix = `[tournament start:${source}]`;

  const { data: tournament, error: tournamentError } = await admin
    .from("tournaments")
    .select("id, created_by, status, max_players")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError) {
    return { ok: false, status: 500, error: tournamentError.message };
  }

  if (!tournament) {
    return { ok: false, status: 404, error: "Tournament not found." };
  }

  if (
    requireCreator &&
    tournament.created_by !== requestedByUserId
  ) {
    return {
      ok: false,
      status: 403,
      error: "Only the tournament creator can start the bracket.",
    };
  }

  if (
    !ALLOWED_START_STATUSES.includes(
      tournament.status as (typeof ALLOWED_START_STATUSES)[number]
    )
  ) {
    return {
      ok: false,
      status: 409,
      error:
        "Tournament must be in registration or check-in status before starting.",
    };
  }

  const priorStatus = tournament.status;
  const maxPlayers = tournament.max_players;

  const { count: existingMatchCount, error: matchCountError } = await admin
    .from("tournament_matches")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);

  if (matchCountError) {
    return { ok: false, status: 500, error: matchCountError.message };
  }

  if ((existingMatchCount ?? 0) > 0) {
    return {
      ok: false,
      status: 409,
      error: "Bracket already exists for this tournament.",
    };
  }

  const { data: activeRows, error: entriesError } = await admin
    .from("tournament_entries")
    .select("id, status, created_at, checked_in_at")
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "checked_in"])
    .order("created_at", { ascending: true });

  if (entriesError) {
    return { ok: false, status: 500, error: entriesError.message };
  }

  const activeCount = activeRows?.length ?? 0;

  if (activeCount < 2) {
    return {
      ok: false,
      status: 400,
      error: "Need at least 2 registered players.",
    };
  }

  const entryIds = (activeRows ?? []).map((row) => row.id);

  let bracketResult;
  try {
    bracketResult = generateBracketWithByes(entryIds, maxPlayers);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error:
        error instanceof Error ? error.message : "Bracket generation failed.",
    };
  }

  const { drafts, bracketSize } = bracketResult;
  const completedAt = new Date().toISOString();
  const playBy = computePlayBy();

  const { data: insertedRows, error: insertError } = await admin
    .from("tournament_matches")
    .insert(
      drafts.map((draft) => ({
        tournament_id: tournamentId,
        round_number: draft.round_number,
        slot_index: draft.slot_index,
        entry_one_id: draft.entry_one_id,
        entry_two_id: draft.entry_two_id,
        status: draft.status,
        winner_entry_id: draft.winner_entry_id ?? null,
        completed_at: draft.status === "walkover" ? completedAt : null,
        play_by: draft.status === "ready" ? playBy : null,
      }))
    )
    .select("id, round_number, slot_index");

  if (insertError) {
    return { ok: false, status: 500, error: insertError.message };
  }

  if (!insertedRows?.length) {
    return {
      ok: false,
      status: 500,
      error: "No bracket rows were created.",
    };
  }

  const idBySlot = new Map<string, string>();
  for (const row of insertedRows) {
    idBySlot.set(bracketSlotKey(row.round_number, row.slot_index), row.id);
  }

  const totalRounds = getTotalRounds(bracketSize);

  for (const draft of drafts) {
    if (draft.round_number >= totalRounds) continue;

    const parent = getParentSlot(draft.round_number, draft.slot_index);
    const parentId = idBySlot.get(
      bracketSlotKey(parent.round_number, parent.slot_index)
    );
    const matchId = idBySlot.get(
      bracketSlotKey(draft.round_number, draft.slot_index)
    );

    if (!parentId || !matchId) {
      try {
        await rollbackTournamentBracket(admin, tournamentId, source);
      } catch (rollbackError) {
        return {
          ok: false,
          status: 500,
          error:
            "Failed to link bracket rounds and bracket rollback also failed. The tournament may be stuck with a partial bracket.",
          rollbackFailed: true,
          detail:
            rollbackError instanceof Error
              ? rollbackError.message
              : undefined,
        };
      }
      return {
        ok: false,
        status: 500,
        error: "Failed to link bracket rounds. Bracket was rolled back.",
      };
    }

    const { error: linkError } = await admin
      .from("tournament_matches")
      .update({ next_match_id: parentId })
      .eq("id", matchId);

    if (linkError) {
      try {
        await rollbackTournamentBracket(admin, tournamentId, source);
      } catch (rollbackError) {
        return {
          ok: false,
          status: 500,
          error:
            "Failed to link bracket rounds and bracket rollback also failed. The tournament may be stuck with a partial bracket.",
          rollbackFailed: true,
          detail:
            rollbackError instanceof Error
              ? rollbackError.message
              : undefined,
        };
      }
      return {
        ok: false,
        status: 500,
        error: `Failed to link bracket rounds. Bracket was rolled back. ${linkError.message}`,
      };
    }
  }

  const { data: updatedTournament, error: statusError } = await admin
    .from("tournaments")
    .update({ status: "in_progress" })
    .eq("id", tournamentId)
    .eq("status", priorStatus)
    .select("id")
    .maybeSingle();

  if (statusError) {
    console.error(`${logPrefix} status update failed:`, statusError.message);
    return { ok: false, status: 500, error: statusError.message };
  }

  if (!updatedTournament) {
    return {
      ok: false,
      status: 409,
      error:
        "Bracket was created but tournament status could not be updated. It may have already started.",
    };
  }

  console.log(`${logPrefix} started tournament ${tournamentId}`, {
    matchCount: insertedRows.length,
    playerCount: activeCount,
    bracketSize,
  });

  return {
    ok: true,
    tournamentId,
    matchCount: insertedRows.length,
    playerCount: activeCount,
  };
}
