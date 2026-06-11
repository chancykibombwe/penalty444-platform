/**
 * Phase 7 — Live competitive ecosystem.
 *
 * Pure data layer for the global activity feed and platform live status.
 * This module deliberately stays frontend-only and READ-ONLY against
 * existing tables (`match_results`, `tournaments`, `player_stats`,
 * `tournament_matches`). It never writes, mutates, or touches gameplay /
 * tournament advancement.
 *
 * Design notes:
 *  - All fetchers return safe defaults on failure ({events:[], counts:{...}})
 *    so the UI can render a neutral "preparing" state instead of crashing.
 *  - Activity events are produced from real rows. We do NOT fabricate
 *    fake players or fake outcomes — only formatting is added.
 *  - We avoid showing literal "No activity" anywhere; consumers should
 *    fall back to the "Preparing live arena activity..." copy if events
 *    is empty.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ActivityEventTone = "live" | "win" | "info" | "champion" | "promotion";

export type ActivityEventKind =
  | "match-win"
  | "tournament-started"
  | "tournament-completed"
  | "champion-crowned"
  | "match-live"
  | "promotion";

export type ActivityEvent = {
  id: string;
  kind: ActivityEventKind;
  tone: ActivityEventTone;
  message: string;
  context?: string;
  /** ISO timestamp of when the underlying event happened. */
  occurredAt: string | null;
  relativeTime: string;
};

export type PlatformLiveCounts = {
  liveMatches: number;
  liveTournaments: number;
  activeEvents: number;
  placementPlayers: number;
  rankedPlayers: number;
};

export type LiveMatchPreviewItem = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  roundLabel: string;
  playerOne: string;
  playerTwo: string;
  /** True when this is the final match in the bracket. */
  isFinal: boolean;
  /** True when this is the semifinal (one step before the final). */
  isSemifinal: boolean;
  status: "in_progress" | "ready";
  /** Room code (when assigned) — enables /watch/[roomCode] navigation. */
  roomCode: string | null;
};

/**
 * Featured match item — used by the home Featured strip and the
 * tournament Live Spotlight. Carries everything needed to render a
 * premium card + a working WATCH link.
 */
export type FeaturedLiveMatch = Omit<LiveMatchPreviewItem, "status"> & {
  /**
   * Why this match is featured. Ordered by priority:
   *   1 = tournament final (in_progress)
   *   2 = tournament semifinal (in_progress)
   *   3 = any tournament match in_progress
   *   4 = tournament match ready
   *   5 = recent casual / completed match
   */
  priority: 1 | 2 | 3 | 4 | 5;
  reason: string;
  /**
   * "completed" is exclusive to the recent-match-history fallback
   * (`fetchRecentMatchHighlights`) — those rows come from finished
   * `match_results` and must never render as live.
   */
  status: "in_progress" | "ready" | "completed";
};

export type RecentPlayerMoment = {
  id: string;
  kind: "champion" | "tournament-win" | "match-win" | "promotion";
  username: string;
  headline: string;
  context: string;
  tone: "champion" | "win" | "info" | "promotion";
  occurredAt: string | null;
  relativeTime: string;
  /** Optional anchor (e.g. tournament detail). */
  href?: string;
};

export const EMPTY_COUNTS: PlatformLiveCounts = {
  liveMatches: 0,
  liveTournaments: 0,
  activeEvents: 0,
  placementPlayers: 0,
  rankedPlayers: 0,
};

const RECENT_MATCH_LIMIT = 6;
const RECENT_TOURNAMENT_LIMIT = 6;
const LIVE_MATCH_LIMIT = 5;

/**
 * Format an ISO timestamp into a short relative label suitable for feed rows.
 * Falls back to the empty string if the input is invalid.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "";

  const diffSec = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (diffSec < 45) return "Just now";
  if (diffSec < 90) return "1m ago";

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}

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

type TournamentRow = {
  id: string;
  name: string | null;
  status: string | null;
  winner_id: string | null;
  starts_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type WinnerStatRow = {
  user_id: string;
  username: string | null;
};

type LiveBracketMatchRow = {
  id: string;
  tournament_id: string;
  status: string | null;
  round_number: number | null;
  next_match_id: string | null;
  entry_one_id: string | null;
  entry_two_id: string | null;
  room_code: string | null;
  started_at: string | null;
  created_at: string | null;
};

/** Recency key for bracket rows (tournament_matches has no updated_at). */
function bracketMatchRecencyMs(row: LiveBracketMatchRow): number {
  const iso =
    row.status === "in_progress"
      ? row.started_at ?? row.created_at
      : row.created_at;
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function compareBracketMatches(
  a: LiveBracketMatchRow,
  b: LiveBracketMatchRow
): number {
  const aLive = a.status === "in_progress";
  const bLive = b.status === "in_progress";
  if (aLive !== bLive) return aLive ? -1 : 1;
  return bracketMatchRecencyMs(b) - bracketMatchRecencyMs(a);
}

function safeName(name: string | null | undefined, fallback = "Player"): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function lookupName(
  map: Map<string, string>,
  id: string | null,
  fallback: string
): string {
  if (!id) return fallback;
  const name = map.get(id);
  return name && name.trim().length > 0 ? name : fallback;
}

function buildMatchWinEvents(rows: MatchResultRow[]): ActivityEvent[] {
  return rows
    .filter((row) => row.created_at)
    .map((row): ActivityEvent | null => {
      const draw = row.is_draw === true;
      const one = safeName(row.player_one_username, "Player 1");
      const two = safeName(row.player_two_username, "Player 2");
      const isTournament = row.match_type === "tournament";

      if (draw) {
        return {
          id: `match:${row.created_at}:${row.room_code ?? ""}`,
          kind: "match-win",
          tone: "info",
          message: `${one} vs ${two} ended in a draw`,
          context: isTournament ? "Tournament match" : "Casual match",
          occurredAt: row.created_at,
          relativeTime: formatRelativeTime(row.created_at),
        };
      }

      const winnerName =
        row.winner_id && row.winner_id === row.player_one_id
          ? one
          : row.winner_id && row.winner_id === row.player_two_id
            ? two
            : null;
      const loserName = winnerName === one ? two : one;
      if (!winnerName) return null;

      const scoreOne = row.player_one_score ?? 0;
      const scoreTwo = row.player_two_score ?? 0;
      const scoreLine =
        winnerName === one
          ? `${scoreOne} – ${scoreTwo}`
          : `${scoreTwo} – ${scoreOne}`;

      return {
        id: `match:${row.created_at}:${row.room_code ?? ""}`,
        kind: "match-win",
        tone: "win",
        message: `${winnerName} defeated ${loserName}`,
        context: `${isTournament ? "Tournament" : "Casual"} · ${scoreLine}`,
        occurredAt: row.created_at,
        relativeTime: formatRelativeTime(row.created_at),
      };
    })
    .filter((event): event is ActivityEvent => event !== null);
}

function buildTournamentEvents(
  rows: TournamentRow[],
  winnerLookup: Map<string, string>
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const row of rows) {
    const name = safeName(row.name, "Tournament");
    const occurredAt = row.updated_at ?? row.starts_at ?? row.created_at;

    if (row.status === "completed") {
      if (row.winner_id) {
        const winnerName = safeName(
          winnerLookup.get(row.winner_id) ?? null,
          "Champion"
        );
        events.push({
          id: `tourney:${row.id}:champion`,
          kind: "champion-crowned",
          tone: "champion",
          message: `${winnerName} crowned champion`,
          context: `${name} · Tournament complete`,
          occurredAt,
          relativeTime: formatRelativeTime(occurredAt),
        });
      } else {
        events.push({
          id: `tourney:${row.id}:completed`,
          kind: "tournament-completed",
          tone: "info",
          message: `${name} ended`,
          context: "Tournament complete",
          occurredAt,
          relativeTime: formatRelativeTime(occurredAt),
        });
      }
      continue;
    }

    if (row.status === "in_progress") {
      events.push({
        id: `tourney:${row.id}:live`,
        kind: "tournament-started",
        tone: "live",
        message: `${name} is now LIVE`,
        context: "Tournament in progress",
        occurredAt,
        relativeTime: formatRelativeTime(occurredAt),
      });
    }
  }

  return events;
}

/**
 * Pull the most recent live-arena activity from the database and assemble it
 * into a single ordered feed. Best-effort — any DB error returns an empty
 * array so the UI can show the safe "preparing" placeholder.
 */
export async function fetchPlatformActivity(
  client: SupabaseClient,
  limit = 8
): Promise<ActivityEvent[]> {
  try {
    const [matchesResult, tournamentsResult] = await Promise.all([
      client
        .from("match_results")
        .select(
          "room_code, match_type, player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, is_draw, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(RECENT_MATCH_LIMIT),
      client
        .from("tournaments")
        .select("id, name, status, winner_id, starts_at, updated_at, created_at")
        .eq("game_id", "penalty444")
        .in("status", ["in_progress", "completed"])
        .order("updated_at", { ascending: false })
        .limit(RECENT_TOURNAMENT_LIMIT),
    ]);

    const matchRows = (matchesResult.data ?? []) as MatchResultRow[];
    const tourneyRows = (tournamentsResult.data ?? []) as TournamentRow[];

    const winnerIds = tourneyRows
      .map((row) => row.winner_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    let winnerLookup = new Map<string, string>();
    if (winnerIds.length > 0) {
      const winnersResult = await client
        .from("player_stats")
        .select("user_id, username")
        .eq("game_id", "penalty444")
        .in("user_id", winnerIds);
      const winnerRows = (winnersResult.data ?? []) as WinnerStatRow[];
      winnerLookup = new Map(
        winnerRows
          .filter((row) => typeof row.user_id === "string")
          .map((row) => [row.user_id, row.username ?? ""])
      );
    }

    const events = [
      ...buildMatchWinEvents(matchRows),
      ...buildTournamentEvents(tourneyRows, winnerLookup),
    ];

    events.sort((a, b) => {
      const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return bTime - aTime;
    });

    return events.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Best-effort platform-wide counts for the live status widget. Returns
 * EMPTY_COUNTS on failure rather than throwing.
 */
export async function fetchPlatformLiveCounts(
  client: SupabaseClient
): Promise<PlatformLiveCounts> {
  try {
    const [
      liveTournamentsResult,
      activeEventsResult,
      placementResult,
      rankedResult,
      liveMatchesResult,
    ] = await Promise.all([
      client
        .from("tournaments")
        .select("id", { count: "estimated", head: true })
        .eq("game_id", "penalty444")
        .eq("status", "in_progress"),
      client
        .from("tournaments")
        .select("id", { count: "estimated", head: true })
        .eq("game_id", "penalty444")
        .in("status", ["registration", "check_in", "in_progress"]),
      client
        .from("player_stats")
        .select("user_id", { count: "estimated", head: true })
        .eq("game_id", "penalty444")
        .gt("matches", 0)
        .lt("matches", 10),
      client
        .from("player_stats")
        .select("user_id", { count: "estimated", head: true })
        .eq("game_id", "penalty444")
        .gte("matches", 10),
      client
        .from("tournament_matches")
        .select("id", { count: "estimated", head: true })
        .eq("status", "in_progress"),
    ]);

    return {
      liveTournaments: liveTournamentsResult.count ?? 0,
      activeEvents: activeEventsResult.count ?? 0,
      placementPlayers: placementResult.count ?? 0,
      rankedPlayers: rankedResult.count ?? 0,
      liveMatches: liveMatchesResult.count ?? 0,
    };
  } catch {
    return { ...EMPTY_COUNTS };
  }
}

/**
 * Fetch a short list of currently-live (or about-to-go-live) tournament
 * matches. Used by the Home page Live Match preview strip. Display-only —
 * no socket / spectator wiring here.
 */
export async function fetchLiveMatchPreviews(
  client: SupabaseClient,
  limit = LIVE_MATCH_LIMIT
): Promise<LiveMatchPreviewItem[]> {
  try {
    // Phase 7: prefer "in_progress" first; only fall back to "ready" if there
    // aren't enough live ones, so the strip always feels active.
    //
    // Order on the server is `created_at desc` only — ordering by `started_at`
    // would push `ready` rows (where started_at IS NULL) out of the candidate
    // set before the client-side `compareBracketMatches` had a chance to
    // surface them. We promote in_progress over ready in JS instead.
    const liveResult = await client
      .from("tournament_matches")
      .select(
        "id, tournament_id, status, round_number, next_match_id, entry_one_id, entry_two_id, room_code, started_at, created_at"
      )
      .in("status", ["in_progress", "ready"])
      .order("created_at", { ascending: false })
      .limit(limit * 2);

    const rows = ((liveResult.data ?? []) as LiveBracketMatchRow[]).sort(
      compareBracketMatches
    );
    if (rows.length === 0) return [];

    const tournamentIds = Array.from(
      new Set(rows.map((row) => row.tournament_id).filter(Boolean))
    );
    const entryIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row.entry_one_id, row.entry_two_id])
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );

    const [tournamentsLookup, entriesLookup] = await Promise.all([
      tournamentIds.length > 0
        ? client
            .from("tournaments")
            .select("id, name")
            .in("id", tournamentIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
      entryIds.length > 0
        ? client
            .from("tournament_entries")
            .select("id, username")
            .in("id", entryIds)
        : Promise.resolve({ data: [] as Array<{ id: string; username: string | null }> }),
    ]);

    const tournamentNameById = new Map<string, string>();
    for (const row of (tournamentsLookup.data ?? []) as Array<{
      id: string;
      name: string | null;
    }>) {
      if (row.id) tournamentNameById.set(row.id, row.name ?? "");
    }
    const entryNameById = new Map<string, string>();
    for (const row of (entriesLookup.data ?? []) as Array<{
      id: string;
      username: string | null;
    }>) {
      if (row.id) entryNameById.set(row.id, row.username ?? "");
    }

    // Compute the highest round number per tournament so we can identify
    // semifinals (= totalRounds - 1) without an extra query.
    const totalRoundsByTournament = new Map<string, number>();
    for (const row of rows) {
      if (!row.round_number) continue;
      const current = totalRoundsByTournament.get(row.tournament_id) ?? 0;
      if (row.round_number > current) {
        totalRoundsByTournament.set(row.tournament_id, row.round_number);
      }
    }

    const previews = rows.map((row) => {
      const tournamentName = lookupName(
        tournamentNameById,
        row.tournament_id,
        "Tournament"
      );
      const playerOne = lookupName(entryNameById, row.entry_one_id, "TBD");
      const playerTwo = lookupName(entryNameById, row.entry_two_id, "TBD");
      const isFinal = row.next_match_id === null;
      const totalRounds = totalRoundsByTournament.get(row.tournament_id) ?? null;
      const isSemifinal =
        !isFinal &&
        totalRounds !== null &&
        row.round_number !== null &&
        row.round_number === totalRounds - 1;

      const roundLabel = isFinal
        ? "Final"
        : isSemifinal
          ? "Semifinal"
          : row.round_number
            ? `Round ${row.round_number}`
            : "Bracket";

      const status: LiveMatchPreviewItem["status"] =
        row.status === "in_progress" ? "in_progress" : "ready";

      return {
        id: row.id,
        tournamentId: row.tournament_id,
        tournamentName,
        roundLabel,
        playerOne,
        playerTwo,
        isFinal,
        isSemifinal,
        status,
        roomCode: row.room_code,
      } satisfies LiveMatchPreviewItem;
    });

    return previews.slice(0, limit);
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------
 * Phase 8 — featured matches + player moments
 * ----------------------------------------------------------------------- */

/**
 * Featured live matches: pulls bracket matches and prioritizes by
 * tournament weight, falling back to recent casual matches so the strip
 * is never empty when there's a record of competition.
 */
export async function fetchFeaturedLiveMatches(
  client: SupabaseClient,
  limit = 4
): Promise<FeaturedLiveMatch[]> {
  const previews = await fetchLiveMatchPreviews(client, Math.max(limit, 6));

  const featured: FeaturedLiveMatch[] = previews.map((item) => {
    let priority: FeaturedLiveMatch["priority"];
    let reason: string;

    if (item.status === "in_progress" && item.isFinal) {
      priority = 1;
      reason = "Final · LIVE";
    } else if (item.status === "in_progress" && item.isSemifinal) {
      priority = 2;
      reason = "Semifinal · LIVE";
    } else if (item.status === "in_progress") {
      priority = 3;
      reason = `${item.roundLabel} · LIVE`;
    } else {
      priority = 4;
      reason = `${item.roundLabel} · Ready`;
    }

    return { ...item, priority, reason };
  });

  // If we already have enough live tournament action, return it sorted.
  if (featured.some((item) => item.priority <= 3)) {
    return featured
      .sort((a, b) => a.priority - b.priority)
      .slice(0, limit);
  }

  // Fallback: surface the most recent casual matches as "Recent battles".
  if (featured.length < limit) {
    const recent = await fetchRecentMatchHighlights(
      client,
      limit - featured.length
    );
    return [...featured, ...recent].slice(0, limit);
  }

  return featured.sort((a, b) => a.priority - b.priority).slice(0, limit);
}

async function fetchRecentMatchHighlights(
  client: SupabaseClient,
  limit: number
): Promise<FeaturedLiveMatch[]> {
  if (limit <= 0) return [];
  try {
    const result = await client
      .from("match_results")
      .select(
        "room_code, match_type, player_one_id, player_one_username, player_two_id, player_two_username, winner_id, is_draw, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    const rows = (result.data ?? []) as Array<{
      room_code: string | null;
      match_type: string | null;
      player_one_id: string | null;
      player_one_username: string | null;
      player_two_id: string | null;
      player_two_username: string | null;
      winner_id: string | null;
      is_draw: boolean | null;
      created_at: string | null;
    }>;

    return rows
      .filter((row) => row.room_code)
      .map((row): FeaturedLiveMatch => {
        const isTournament = row.match_type === "tournament";
        return {
          id: `recent:${row.room_code}:${row.created_at}`,
          tournamentId: "",
          tournamentName: isTournament ? "Tournament" : "Casual room",
          roundLabel: isTournament ? "Tournament match" : "Casual",
          playerOne: safeName(row.player_one_username, "Player 1"),
          playerTwo: safeName(row.player_two_username, "Player 2"),
          isFinal: false,
          isSemifinal: false,
          status: "completed",
          roomCode: row.room_code,
          priority: 5,
          reason: "Recent result",
        };
      });
  } catch {
    return [];
  }
}

/**
 * Player moments — recent champions and recent winners for the
 * "Featured Player Moments" home strip. Read-only, no fake data.
 */
export async function fetchRecentPlayerMoments(
  client: SupabaseClient,
  limit = 5
): Promise<RecentPlayerMoment[]> {
  try {
    const [championsResult, recentWinsResult] = await Promise.all([
      client
        .from("tournaments")
        .select("id, name, winner_id, updated_at")
        .eq("game_id", "penalty444")
        .eq("status", "completed")
        .not("winner_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(limit),
      client
        .from("match_results")
        .select(
          "room_code, match_type, player_one_id, player_one_username, player_one_score, player_two_id, player_two_username, player_two_score, winner_id, is_draw, created_at"
        )
        .eq("is_draw", false)
        .not("winner_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit * 2),
    ]);

    const championRows = (championsResult.data ?? []) as Array<{
      id: string;
      name: string | null;
      winner_id: string | null;
      updated_at: string | null;
    }>;
    const winRows = (recentWinsResult.data ?? []) as Array<MatchResultRow>;

    const winnerIds = Array.from(
      new Set(
        championRows
          .map((row) => row.winner_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    let championUsernames = new Map<string, string>();
    if (winnerIds.length > 0) {
      const usernamesResult = await client
        .from("player_stats")
        .select("user_id, username")
        .eq("game_id", "penalty444")
        .in("user_id", winnerIds);
      const rows = (usernamesResult.data ?? []) as WinnerStatRow[];
      championUsernames = new Map(
        rows
          .filter((row) => typeof row.user_id === "string")
          .map((row) => [row.user_id, row.username ?? ""])
      );
    }

    const moments: RecentPlayerMoment[] = [];

    for (const row of championRows) {
      if (!row.winner_id) continue;
      const username = safeName(
        championUsernames.get(row.winner_id) ?? null,
        "Champion"
      );
      moments.push({
        id: `champion:${row.id}`,
        kind: "champion",
        username,
        headline: `${username} crowned champion`,
        context: `${safeName(row.name, "Tournament")} · Tournament won`,
        tone: "champion",
        occurredAt: row.updated_at,
        relativeTime: formatRelativeTime(row.updated_at),
        href: `/tournaments/${row.id}`,
      });
    }

    for (const row of winRows) {
      if (!row.winner_id || !row.created_at) continue;
      const winnerName =
        row.winner_id === row.player_one_id
          ? safeName(row.player_one_username, "Player")
          : row.winner_id === row.player_two_id
            ? safeName(row.player_two_username, "Player")
            : null;
      if (!winnerName) continue;

      const winnerScore =
        row.winner_id === row.player_one_id
          ? row.player_one_score ?? 0
          : row.player_two_score ?? 0;
      const loserScore =
        row.winner_id === row.player_one_id
          ? row.player_two_score ?? 0
          : row.player_one_score ?? 0;

      moments.push({
        id: `win:${row.room_code}:${row.created_at}`,
        kind: row.match_type === "tournament" ? "tournament-win" : "match-win",
        username: winnerName,
        headline: `${winnerName} won ${winnerScore} – ${loserScore}`,
        context:
          row.match_type === "tournament" ? "Tournament match" : "Casual match",
        tone: "win",
        occurredAt: row.created_at,
        relativeTime: formatRelativeTime(row.created_at),
      });
    }

    moments.sort((a, b) => {
      const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return bTime - aTime;
    });

    return moments.slice(0, limit);
  } catch {
    return [];
  }
}
