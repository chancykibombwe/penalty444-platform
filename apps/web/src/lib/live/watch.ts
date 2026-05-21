/**
 * Phase 8 — Spectator data layer.
 *
 * Read-only resolver for `/watch/[roomCode]`. Builds a `WatchableMatch`
 * snapshot from existing DB tables and POLLS for updates. This file
 * deliberately never opens a gameplay socket, never emits player events,
 * and never touches advancement / wallet logic.
 *
 * What spectators can safely see (from DB):
 *   - Tournament name, round number, final/semifinal flag, in-progress / ready
 *   - Player names (from tournament_entries or match_results)
 *   - Final scores ONLY after the round is persisted to `match_results`
 *
 * What spectators MUST NOT see (and we never fetch):
 *   - In-flight lane picks (they only exist in realtime-server memory)
 *   - Player identities for non-tournament private rooms beyond what
 *     `match_results` already exposes after the match ends
 *
 * Foundation only: a future phase can wire a passive `watch:subscribe`
 * socket handler to get per-round reveals — the spectator components are
 * already structured to receive that data when it arrives.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type WatchSource = "tournament" | "casual" | "unknown";

export type WatchableMatchStatus =
  | "ready"
  | "in_progress"
  | "completed"
  | "walkover"
  | "unknown";

export type WatchableMatch = {
  roomCode: string;
  source: WatchSource;

  /** Tournament wrapper, populated only when source = "tournament". */
  tournament: {
    id: string;
    name: string;
    roundNumber: number | null;
    totalRounds: number | null;
    isFinal: boolean;
    isSemifinal: boolean;
  } | null;

  /** Bracket match metadata. */
  bracketMatch: {
    id: string;
    status: WatchableMatchStatus;
    nextMatchId: string | null;
    updatedAt: string | null;
  } | null;

  playerOne: WatchablePlayer;
  playerTwo: WatchablePlayer;

  /** Final score (only populated after the match ends). */
  finalScore: {
    playerOne: number;
    playerTwo: number;
    winnerId: string | null;
    isDraw: boolean;
    finishedAt: string | null;
  } | null;
};

export type WatchablePlayer = {
  userId: string | null;
  username: string;
};

const UNKNOWN_NAME = "Unknown";
const TBD_NAME = "TBD";

function safeName(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normaliseStatus(value: string | null | undefined): WatchableMatchStatus {
  switch (value) {
    case "ready":
    case "in_progress":
    case "completed":
    case "walkover":
      return value;
    default:
      return "unknown";
  }
}

type TournamentMatchRow = {
  id: string;
  tournament_id: string;
  status: string | null;
  round_number: number | null;
  next_match_id: string | null;
  entry_one_id: string | null;
  entry_two_id: string | null;
  room_code: string | null;
  updated_at: string | null;
};

type TournamentRow = {
  id: string;
  name: string | null;
};

type EntryRow = {
  id: string;
  user_id: string | null;
  username: string | null;
};

type MatchResultRow = {
  room_code: string | null;
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

/**
 * Resolves the safest spectator-viewable snapshot for a `roomCode`.
 *
 * Lookup order:
 *   1. `tournament_matches.room_code` → live tournament context + entries
 *   2. `match_results.room_code` (most recent) → final scores fallback
 *
 * Returns `null` only if BOTH lookups fail (room doesn't exist or has no
 * persistence yet). Spectator pages should render a "Preparing live
 * spectator view…" placeholder for that case rather than a hard error.
 */
export async function fetchWatchableMatch(
  client: SupabaseClient,
  roomCode: string
): Promise<WatchableMatch | null> {
  const normalised = roomCode.trim().toUpperCase();
  if (!normalised) return null;

  try {
    // 1) Tournament bracket lookup — covers live + ready + recently
    //    completed tournament matches.
    const bracketResult = await client
      .from("tournament_matches")
      .select(
        "id, tournament_id, status, round_number, next_match_id, entry_one_id, entry_two_id, room_code, updated_at"
      )
      .eq("room_code", normalised)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const bracketRow = (bracketResult.data ?? null) as TournamentMatchRow | null;

    // 2) Match results lookup — works for casual matches AND fills in the
    //    final score for tournament matches that just ended.
    const resultRow = await fetchLatestMatchResultByRoom(client, normalised);

    if (bracketRow) {
      return await buildTournamentWatchable(client, bracketRow, resultRow);
    }

    if (resultRow) {
      return buildCasualWatchable(normalised, resultRow);
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchLatestMatchResultByRoom(
  client: SupabaseClient,
  roomCode: string
): Promise<MatchResultRow | null> {
  try {
    const result = await client
      .from("match_results")
      .select(
        "room_code, player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, is_draw, created_at"
      )
      .eq("room_code", roomCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (result.data ?? null) as MatchResultRow | null;
  } catch {
    return null;
  }
}

async function buildTournamentWatchable(
  client: SupabaseClient,
  match: TournamentMatchRow,
  resultRow: MatchResultRow | null
): Promise<WatchableMatch> {
  const [tournamentLookup, entriesLookup, totalRoundsLookup] = await Promise.all([
    client
      .from("tournaments")
      .select("id, name")
      .eq("id", match.tournament_id)
      .maybeSingle(),
    fetchEntriesByIds(client, [match.entry_one_id, match.entry_two_id]),
    client
      .from("tournament_matches")
      .select("round_number")
      .eq("tournament_id", match.tournament_id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const tournamentRow = (tournamentLookup.data ?? null) as TournamentRow | null;
  const entries = entriesLookup;
  const totalRoundsRow = (totalRoundsLookup.data ?? null) as {
    round_number: number | null;
  } | null;

  const totalRounds = totalRoundsRow?.round_number ?? null;
  const isFinal = match.next_match_id === null;
  const isSemifinal =
    totalRounds !== null &&
    match.round_number !== null &&
    !isFinal &&
    match.round_number === totalRounds - 1;

  const playerOneEntry = match.entry_one_id
    ? entries.get(match.entry_one_id)
    : null;
  const playerTwoEntry = match.entry_two_id
    ? entries.get(match.entry_two_id)
    : null;

  const playerOne: WatchablePlayer = {
    userId: playerOneEntry?.user_id ?? null,
    username: safeName(playerOneEntry?.username ?? null, TBD_NAME),
  };
  const playerTwo: WatchablePlayer = {
    userId: playerTwoEntry?.user_id ?? null,
    username: safeName(playerTwoEntry?.username ?? null, TBD_NAME),
  };

  return {
    roomCode: match.room_code ?? "",
    source: "tournament",
    tournament: {
      id: match.tournament_id,
      name: safeName(tournamentRow?.name ?? null, "Tournament"),
      roundNumber: match.round_number,
      totalRounds,
      isFinal,
      isSemifinal,
    },
    bracketMatch: {
      id: match.id,
      status: normaliseStatus(match.status),
      nextMatchId: match.next_match_id,
      updatedAt: match.updated_at,
    },
    playerOne,
    playerTwo,
    finalScore: resultRow ? buildFinalScore(resultRow, playerOne, playerTwo) : null,
  };
}

function buildCasualWatchable(
  roomCode: string,
  result: MatchResultRow
): WatchableMatch {
  const playerOne: WatchablePlayer = {
    userId: result.player_one_id,
    username: safeName(result.player_one_username, UNKNOWN_NAME),
  };
  const playerTwo: WatchablePlayer = {
    userId: result.player_two_id,
    username: safeName(result.player_two_username, UNKNOWN_NAME),
  };

  return {
    roomCode,
    source: "casual",
    tournament: null,
    bracketMatch: null,
    playerOne,
    playerTwo,
    finalScore: buildFinalScore(result, playerOne, playerTwo),
  };
}

function buildFinalScore(
  result: MatchResultRow,
  playerOne: WatchablePlayer,
  playerTwo: WatchablePlayer
): WatchableMatch["finalScore"] {
  // match_results uses its own player_one_id, which may not align with the
  // tournament entry order. Re-anchor scores onto our resolved players.
  const resultP1Id = result.player_one_id;
  const resultP2Id = result.player_two_id;
  const resultP1Score = result.player_one_score ?? 0;
  const resultP2Score = result.player_two_score ?? 0;

  let pOneScore = resultP1Score;
  let pTwoScore = resultP2Score;
  if (
    playerOne.userId &&
    resultP2Id &&
    playerOne.userId === resultP2Id &&
    playerTwo.userId &&
    resultP1Id &&
    playerTwo.userId === resultP1Id
  ) {
    pOneScore = resultP2Score;
    pTwoScore = resultP1Score;
  }

  return {
    playerOne: pOneScore,
    playerTwo: pTwoScore,
    winnerId: result.winner_id ?? null,
    isDraw: result.is_draw === true,
    finishedAt: result.created_at,
  };
}

async function fetchEntriesByIds(
  client: SupabaseClient,
  ids: Array<string | null>
): Promise<Map<string, EntryRow>> {
  const filtered = ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
  if (filtered.length === 0) return new Map();

  try {
    const result = await client
      .from("tournament_entries")
      .select("id, user_id, username")
      .in("id", filtered);
    const rows = (result.data ?? []) as EntryRow[];
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

/** Round label helper for spectator chrome. */
export function watchableRoundLabel(match: WatchableMatch): string {
  if (!match.tournament) return "Casual match";
  const { isFinal, isSemifinal, roundNumber, totalRounds } = match.tournament;
  if (isFinal) return "Final";
  if (isSemifinal) return "Semifinal";
  if (roundNumber && totalRounds) return `Round ${roundNumber} / ${totalRounds}`;
  if (roundNumber) return `Round ${roundNumber}`;
  return "Bracket";
}

/** Status pill copy for the watch header. */
export function watchableStatusLabel(match: WatchableMatch): {
  label: string;
  tone: "live" | "ready" | "ended" | "neutral";
} {
  if (match.finalScore) return { label: "Final", tone: "ended" };
  const status = match.bracketMatch?.status;
  if (status === "in_progress") return { label: "Live", tone: "live" };
  if (status === "ready") return { label: "Ready", tone: "ready" };
  if (status === "walkover") return { label: "Walkover", tone: "ended" };
  return { label: "Preparing", tone: "neutral" };
}
