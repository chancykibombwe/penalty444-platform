"use client";

/**
 * Match history read helpers (v1, read-only).
 *
 * Reads the existing public-read `public.match_results` table. RLS already
 * allows SELECT for everyone and blocks all client writes
 * (see 20260523080000_rls_security_hardening.sql), so NO migration is needed.
 *
 * Access control is enforced in the QUERY: we always filter to rows where the
 * viewer is player one or player two, so a player only ever sees matches they
 * participated in. The details fetch additionally verifies participation
 * before returning a row.
 *
 * Nothing here mutates data, touches sockets, gameplay, settlement,
 * progression, or wallet logic.
 */

import { supabase } from "../supabase/client";

export const MATCH_HISTORY_PAGE_SIZE = 25;

const MATCH_COLUMNS =
  "id, room_code, match_instance, match_type, player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, loser_id, is_draw, created_at";

type MatchResultRow = {
  id: string;
  room_code: string;
  match_instance: number;
  match_type: string | null;
  player_one_id: string;
  player_one_username: string;
  player_one_score: number;
  player_two_id: string;
  player_two_username: string;
  player_two_score: number;
  winner_id: string | null;
  loser_id: string | null;
  is_draw: boolean;
  created_at: string | null;
};

export type MatchResult = "W" | "D" | "L";

/** A view-model row — only safe, display-ready fields. No raw ids leak out. */
export type MatchHistoryEntry = {
  id: string;
  result: MatchResult;
  opponentUsername: string;
  /** "You 3 – 2 Opp" friendly score, viewer-first. */
  myScore: number;
  opponentScore: number;
  matchTypeLabel: string;
  /** Raw normalized type for filtering: public | private | ranked | tournament | other */
  matchTypeKey: MatchTypeKey;
  roomCode: string;
  createdAt: string | null;
  isTournament: boolean;
};

export type MatchTypeKey =
  | "public"
  | "private"
  | "ranked"
  | "tournament"
  | "other";

export type MatchDetail = MatchHistoryEntry & {
  /** Both player display names, viewer-first. */
  myUsername: string;
  matchInstance: number;
};

export function normalizeMatchTypeKey(raw: string | null): MatchTypeKey {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "public":
      return "public";
    case "private":
      return "private";
    case "ranked":
      return "ranked";
    case "tournament":
      return "tournament";
    default:
      return "other";
  }
}

export function formatMatchTypeLabel(key: MatchTypeKey): string {
  switch (key) {
    case "public":
      return "Public";
    case "private":
      return "Private";
    case "ranked":
      return "Ranked";
    case "tournament":
      return "Tournament";
    default:
      return "Match";
  }
}

function deriveResult(row: MatchResultRow, viewerId: string): MatchResult {
  if (row.is_draw) return "D";
  return row.winner_id === viewerId ? "W" : "L";
}

function toEntry(row: MatchResultRow, viewerId: string): MatchHistoryEntry {
  const isPlayerOne = viewerId === row.player_one_id;
  const opponentUsername = isPlayerOne
    ? row.player_two_username
    : row.player_one_username;
  const myScore = isPlayerOne ? row.player_one_score : row.player_two_score;
  const opponentScore = isPlayerOne
    ? row.player_two_score
    : row.player_one_score;
  const matchTypeKey = normalizeMatchTypeKey(row.match_type);

  return {
    id: row.id,
    result: deriveResult(row, viewerId),
    opponentUsername: (opponentUsername ?? "").trim() || "Unknown player",
    myScore,
    opponentScore,
    matchTypeLabel: formatMatchTypeLabel(matchTypeKey),
    matchTypeKey,
    roomCode: row.room_code,
    createdAt: row.created_at,
    isTournament: matchTypeKey === "tournament",
  };
}

export type FetchMatchHistoryResult =
  | { ok: true; entries: MatchHistoryEntry[]; hasMore: boolean }
  | { ok: false; error: string };

/**
 * Fetch a page of the viewer's completed matches, newest first.
 *
 * `offset` enables a simple "Load more". We fetch PAGE_SIZE + 1 to detect
 * whether more rows exist without a separate count query.
 */
export async function fetchMatchHistory(
  viewerId: string,
  offset = 0
): Promise<FetchMatchHistoryResult> {
  if (!viewerId) {
    return { ok: false, error: "Could not load match history." };
  }

  const from = offset;
  const to = offset + MATCH_HISTORY_PAGE_SIZE; // inclusive → fetches PAGE_SIZE + 1

  const { data, error } = await supabase
    .from("match_results")
    .select(MATCH_COLUMNS)
    // Access control: only matches this player took part in.
    .or(`player_one_id.eq.${viewerId},player_two_id.eq.${viewerId}`)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return { ok: false, error: "Could not load match history." };
  }

  const rows = (data ?? []) as MatchResultRow[];
  const hasMore = rows.length > MATCH_HISTORY_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, MATCH_HISTORY_PAGE_SIZE) : rows;

  return {
    ok: true,
    entries: page.map((row) => toEntry(row, viewerId)),
    hasMore,
  };
}

export type FetchMatchDetailResult =
  | { ok: true; detail: MatchDetail }
  | { ok: false; error: string; notFound: boolean };

/**
 * Fetch a single match by id, but ONLY if the viewer participated in it.
 * Returns notFound for both "missing" and "not yours" so we never reveal
 * the existence of someone else's match.
 */
export async function fetchMatchById(
  matchId: string,
  viewerId: string
): Promise<FetchMatchDetailResult> {
  if (!matchId || !viewerId) {
    return { ok: false, error: "Match not found.", notFound: true };
  }

  // Access control is enforced IN THE QUERY: filter by id AND viewer
  // participation so the row never reaches the browser/network layer unless
  // the viewer was one of the two players. (match_results is public-read, so
  // a post-fetch-only check would still ship other players' rows over the
  // wire.) The post-fetch check below is kept as defense in depth.
  const { data, error } = await supabase
    .from("match_results")
    .select(MATCH_COLUMNS)
    .eq("id", matchId)
    .or(`player_one_id.eq.${viewerId},player_two_id.eq.${viewerId}`)
    .maybeSingle();

  if (error) {
    return { ok: false, error: "Could not load this match.", notFound: false };
  }

  const row = data as MatchResultRow | null;

  // Participation check (defense in depth): viewer must be one of the two
  // players. The query above already guarantees this, but we re-assert it so
  // the invariant is enforced even if the query filter is ever changed.
  if (
    !row ||
    (row.player_one_id !== viewerId && row.player_two_id !== viewerId)
  ) {
    return { ok: false, error: "Match not found.", notFound: true };
  }

  const entry = toEntry(row, viewerId);
  const isPlayerOne = viewerId === row.player_one_id;

  return {
    ok: true,
    detail: {
      ...entry,
      myUsername:
        (isPlayerOne ? row.player_one_username : row.player_two_username)?.trim() ||
        "You",
      matchInstance: row.match_instance,
    },
  };
}

export function formatMatchDate(createdAt: string | null): string {
  if (!createdAt) return "—";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMatchDateTime(createdAt: string | null): string {
  if (!createdAt) return "—";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
