import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { UNRANKED_MATCHES_THRESHOLD } from "../../../../lib/player/ranks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Admin email gate (server-only) ──────────────────────────────────────────
// Set ADMIN_EMAILS=email1@example.com,email2@example.com on the server.
// Never use NEXT_PUBLIC_ADMIN_EMAILS — that would expose the list to all clients.

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Response types ───────────────────────────────────────────────────────────

export type AdminHealthData = {
  matchResultsCount: number;
  tournamentsCount: number;
  rankedPlayersCount: number;
  placementPlayersCount: number;
  realtimeUrlConfigured: boolean;
  economyMode: string;
};

export type AdminMatchRow = {
  roomCode: string;
  matchType: string | null;
  playerOneUsername: string;
  playerTwoUsername: string;
  playerOneScore: number;
  playerTwoScore: number;
  winnerUsername: string | null;
  isDraw: boolean;
  createdAt: string;
};

export type AdminTournamentRow = {
  id: string;
  name: string;
  status: string;
  maxPlayers: number;
  entryCount: number;
  matchCount: number;
  createdAt: string;
  startsAt: string | null;
};

export type AdminPlayerRow = {
  username: string;
  matches: number;
  wins: number;
  losses: number;
  rankPoints: number;
  isRanked: boolean;
};

export type AdminDataResponse = {
  health: AdminHealthData;
  recentMatches: AdminMatchRow[];
  tournaments: AdminTournamentRow[];
  players: AdminPlayerRow[];
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // 1. Extract Bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 2. Build admin client (service role — server-only, never sent to client)
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "admin_client_unavailable", detail: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }

  // 3. Verify token — getUser validates the JWT cryptographically
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);

  if (authError || !user || !user.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 4. Check admin allowlist (server-side only)
  const adminEmails = getAdminEmails();
  if (adminEmails.length === 0 || !adminEmails.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 5. Fetch data — all via service role (bypasses RLS safely on the server)
  const [
    matchCountResult,
    tournamentCountResult,
    rankedCountResult,
    placementCountResult,
    recentMatchesResult,
    recentTournamentsResult,
    topPlayersResult,
  ] = await Promise.all([
    admin
      .from("match_results")
      .select("*", { count: "exact", head: true }),
    admin
      .from("tournaments")
      .select("*", { count: "exact", head: true })
      .eq("game_id", "penalty444"),
    admin
      .from("player_stats")
      .select("*", { count: "exact", head: true })
      .eq("game_id", "penalty444")
      .gte("matches", UNRANKED_MATCHES_THRESHOLD),
    admin
      .from("player_stats")
      .select("*", { count: "exact", head: true })
      .eq("game_id", "penalty444")
      .gt("matches", 0)
      .lt("matches", UNRANKED_MATCHES_THRESHOLD),
    admin
      .from("match_results")
      .select(
        "room_code, match_type, player_one_id, player_two_id, player_one_username, player_two_username, player_one_score, player_two_score, winner_id, is_draw, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("tournaments")
      .select("id, name, status, format, max_players, created_at, starts_at")
      .eq("game_id", "penalty444")
      .order("created_at", { ascending: false })
      .limit(15),
    admin
      .from("player_stats")
      .select("user_id, username, matches, wins, losses, draws, rank_points")
      .eq("game_id", "penalty444")
      .order("rank_points", { ascending: false })
      .order("matches", { ascending: false })
      .limit(15),
  ]);

  // 6. Fetch entry + match counts for the listed tournaments
  const tournamentIds = (recentTournamentsResult.data ?? []).map((t) => t.id);

  const [entriesResult, tMatchesResult] = await Promise.all([
    tournamentIds.length > 0
      ? admin
          .from("tournament_entries")
          .select("tournament_id")
          .in("tournament_id", tournamentIds)
      : Promise.resolve({ data: [] as { tournament_id: string }[] }),
    tournamentIds.length > 0
      ? admin
          .from("tournament_matches")
          .select("tournament_id")
          .in("tournament_id", tournamentIds)
      : Promise.resolve({ data: [] as { tournament_id: string }[] }),
  ]);

  const entryCount: Record<string, number> = {};
  const matchCount: Record<string, number> = {};
  for (const e of entriesResult.data ?? []) {
    entryCount[e.tournament_id] = (entryCount[e.tournament_id] ?? 0) + 1;
  }
  for (const m of tMatchesResult.data ?? []) {
    matchCount[m.tournament_id] = (matchCount[m.tournament_id] ?? 0) + 1;
  }

  // 7. Shape response — no secrets, no service-role key, no raw UUIDs beyond necessary
  const health: AdminHealthData = {
    matchResultsCount: matchCountResult.count ?? 0,
    tournamentsCount: tournamentCountResult.count ?? 0,
    rankedPlayersCount: rankedCountResult.count ?? 0,
    placementPlayersCount: placementCountResult.count ?? 0,
    realtimeUrlConfigured: Boolean(process.env.NEXT_PUBLIC_REALTIME_URL),
    economyMode: process.env.NEXT_PUBLIC_ECONOMY_MODE ?? "not_set",
  };

  const recentMatches: AdminMatchRow[] = (recentMatchesResult.data ?? []).map(
    (m) => {
      let winnerUsername: string | null = null;
      if (m.is_draw) {
        winnerUsername = "Draw";
      } else if (m.winner_id && m.winner_id === m.player_one_id) {
        winnerUsername = m.player_one_username;
      } else if (m.winner_id && m.winner_id === m.player_two_id) {
        winnerUsername = m.player_two_username;
      }
      return {
        roomCode: m.room_code,
        matchType: m.match_type ?? null,
        playerOneUsername: m.player_one_username,
        playerTwoUsername: m.player_two_username,
        playerOneScore: m.player_one_score ?? 0,
        playerTwoScore: m.player_two_score ?? 0,
        winnerUsername,
        isDraw: m.is_draw ?? false,
        createdAt: m.created_at,
      };
    }
  );

  const tournaments: AdminTournamentRow[] = (
    recentTournamentsResult.data ?? []
  ).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    maxPlayers: t.max_players,
    entryCount: entryCount[t.id] ?? 0,
    matchCount: matchCount[t.id] ?? 0,
    createdAt: t.created_at,
    startsAt: t.starts_at ?? null,
  }));

  const players: AdminPlayerRow[] = (topPlayersResult.data ?? []).map((p) => ({
    username: p.username,
    matches: p.matches,
    wins: p.wins,
    losses: p.losses,
    rankPoints: p.rank_points,
    isRanked: p.matches >= UNRANKED_MATCHES_THRESHOLD,
  }));

  const response: AdminDataResponse = {
    health,
    recentMatches,
    tournaments,
    players,
  };

  return NextResponse.json(response);
}
