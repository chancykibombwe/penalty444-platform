import type { SupabaseClient } from "@supabase/supabase-js";
import type { TournamentEntryRef } from "@/lib/tournament/presence";

export type RequestRealtimeTournamentRoomParams = {
  tournamentId: string;
  tournamentMatchId: string;
  entryOne: TournamentEntryRef;
  entryTwo: TournamentEntryRef;
  admin: SupabaseClient;
  maxRounds?: number;
};

export type RequestRealtimeTournamentRoomResult =
  | {
      ok: true;
      roomCode: string;
      existing: boolean;
      persisted: boolean;
    }
  | { ok: false; error: string };

async function postRealtimeTournamentRoom(payload: {
  tournamentId: string;
  tournamentMatchId: string;
  allowedPlayerIds: string[];
  notifyPlayerIds: string[];
  maxRounds: number;
}): Promise<{ roomCode: string; existing: boolean }> {
  const baseUrl =
    process.env.REALTIME_INTERNAL_URL ?? "http://localhost:4000";
  const secret = process.env.REALTIME_INTERNAL_SECRET ?? "";

  if (!secret) {
    throw new Error("Realtime internal API is not configured.");
  }

  const response = await fetch(`${baseUrl}/internal/tournament-rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-realtime-internal-secret": secret,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as {
    roomCode?: string;
    existing?: boolean;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error ?? "Failed to create tournament room.");
  }

  if (!data.roomCode) {
    throw new Error("Realtime server did not return a room code.");
  }

  return {
    roomCode: data.roomCode,
    existing: Boolean(data.existing),
  };
}

async function resolveMaxRounds(
  admin: SupabaseClient,
  tournamentId: string,
  maxRounds?: number
): Promise<number> {
  if (typeof maxRounds === "number" && maxRounds > 0) {
    return maxRounds;
  }

  const { data: tournament, error } = await admin
    .from("tournaments")
    .select("rounds_per_match")
    .eq("id", tournamentId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const resolved = tournament?.rounds_per_match;
  return typeof resolved === "number" && resolved > 0 ? resolved : 3;
}

async function persistTournamentMatchRoom(
  admin: SupabaseClient,
  tournamentId: string,
  tournamentMatchId: string,
  roomCode: string
): Promise<{ roomCode: string; persisted: boolean }> {
  const startedAt = new Date().toISOString();

  const { data: updatedMatch, error: updateError } = await admin
    .from("tournament_matches")
    .update({
      room_code: roomCode,
      started_at: startedAt,
      status: "in_progress",
    })
    .eq("id", tournamentMatchId)
    .eq("tournament_id", tournamentId)
    .is("room_code", null)
    .select("room_code")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (updatedMatch?.room_code) {
    return { roomCode: updatedMatch.room_code, persisted: true };
  }

  const { data: racedMatch, error: racedError } = await admin
    .from("tournament_matches")
    .select("room_code")
    .eq("id", tournamentMatchId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (racedError) {
    throw new Error(racedError.message);
  }

  if (racedMatch?.room_code) {
    return { roomCode: racedMatch.room_code, persisted: false };
  }

  throw new Error("Failed to persist tournament room.");
}

/**
 * Creates a realtime tournament room and persists room_code on the match (idempotent).
 * Does not record player presence — opponent_join_by is set when a player appears.
 */
export async function requestRealtimeTournamentRoom({
  tournamentId,
  tournamentMatchId,
  entryOne,
  entryTwo,
  admin,
  maxRounds,
}: RequestRealtimeTournamentRoomParams): Promise<RequestRealtimeTournamentRoomResult> {
  try {
    const resolvedMaxRounds = await resolveMaxRounds(
      admin,
      tournamentId,
      maxRounds
    );

    const notifyPlayerIds = [entryOne.user_id, entryTwo.user_id];

    const realtimeResult = await postRealtimeTournamentRoom({
      tournamentId,
      tournamentMatchId,
      allowedPlayerIds: notifyPlayerIds,
      notifyPlayerIds,
      maxRounds: resolvedMaxRounds,
    });

    const persisted = await persistTournamentMatchRoom(
      admin,
      tournamentId,
      tournamentMatchId,
      realtimeResult.roomCode
    );

    return {
      ok: true,
      roomCode: persisted.roomCode,
      existing: realtimeResult.existing,
      persisted: persisted.persisted,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create tournament room.",
    };
  }
}

export type AutoCreateRealtimeRoomParams = {
  admin: SupabaseClient;
  tournamentId: string;
  matchId: string;
  maxRounds?: number;
  logPrefix?: string;
};

/**
 * Auto-creates a realtime room for a ready match with both feeders assigned.
 * Safe to call when room_code may already exist (no-op).
 */
export async function autoCreateRealtimeRoomForReadyMatch({
  admin,
  tournamentId,
  matchId,
  maxRounds,
  logPrefix = "[tournament rooms]",
}: AutoCreateRealtimeRoomParams): Promise<RequestRealtimeTournamentRoomResult> {
  const { data: match, error: matchError } = await admin
    .from("tournament_matches")
    .select(
      "id, tournament_id, entry_one_id, entry_two_id, room_code, status, winner_entry_id"
    )
    .eq("id", matchId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (matchError) {
    const message = matchError.message;
    console.warn(`${logPrefix} match ${matchId} load failed:`, message);
    return { ok: false, error: message };
  }

  if (!match) {
    const message = "Match not found.";
    console.warn(`${logPrefix} match ${matchId}:`, message);
    return { ok: false, error: message };
  }

  if (match.room_code) {
    return {
      ok: true,
      roomCode: match.room_code,
      existing: true,
      persisted: false,
    };
  }

  if (match.status !== "ready") {
    return { ok: false, error: "Match is not ready for room creation." };
  }

  if (match.winner_entry_id) {
    return { ok: false, error: "Match already has a winner." };
  }

  if (!match.entry_one_id || !match.entry_two_id) {
    return { ok: false, error: "Both entries must be assigned." };
  }

  const entryIds = [match.entry_one_id, match.entry_two_id];

  const { data: entryRows, error: entriesError } = await admin
    .from("tournament_entries")
    .select("id, user_id, status")
    .in("id", entryIds);

  if (entriesError) {
    console.warn(
      `${logPrefix} match ${matchId} entries load failed:`,
      entriesError.message
    );
    return { ok: false, error: entriesError.message };
  }

  if (!entryRows || entryRows.length !== 2) {
    const message = "Could not resolve tournament entries for this match.";
    console.warn(`${logPrefix} match ${matchId}:`, message);
    return { ok: false, error: message };
  }

  const entryById = new Map(entryRows.map((row) => [row.id, row]));
  const entryOne = entryById.get(match.entry_one_id);
  const entryTwo = entryById.get(match.entry_two_id);

  if (!entryOne || !entryTwo) {
    const message = "Could not resolve tournament entries for this match.";
    console.warn(`${logPrefix} match ${matchId}:`, message);
    return { ok: false, error: message };
  }

  for (const entry of [entryOne, entryTwo]) {
    if (entry.status === "withdrawn") {
      const message = "A participant has withdrawn from this match.";
      console.warn(`${logPrefix} match ${matchId}:`, message);
      return { ok: false, error: message };
    }
  }

  const result = await requestRealtimeTournamentRoom({
    tournamentId,
    tournamentMatchId: matchId,
    entryOne,
    entryTwo,
    admin,
    maxRounds,
  });

  if (!result.ok) {
    console.warn(
      `${logPrefix} auto-create failed for match ${matchId}:`,
      result.error
    );
  }

  return result;
}

export async function autoCreateRealtimeRoomsForReadyMatches({
  admin,
  tournamentId,
  maxRounds,
  logPrefix = "[tournament rooms]",
}: {
  admin: SupabaseClient;
  tournamentId: string;
  maxRounds?: number;
  logPrefix?: string;
}): Promise<void> {
  const { data: readyMatches, error } = await admin
    .from("tournament_matches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("status", "ready")
    .not("entry_one_id", "is", null)
    .not("entry_two_id", "is", null)
    .is("room_code", null);

  if (error) {
    console.warn(
      `${logPrefix} ready match query failed for tournament ${tournamentId}:`,
      error.message
    );
    return;
  }

  for (const match of readyMatches ?? []) {
    await autoCreateRealtimeRoomForReadyMatch({
      admin,
      tournamentId,
      matchId: match.id,
      maxRounds,
      logPrefix,
    });
  }
}
