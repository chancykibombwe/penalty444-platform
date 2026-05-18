import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  recordTournamentMatchPresence,
  type TournamentEntryRef,
} from "@/lib/tournament/presence";
import { requestRealtimeTournamentRoom } from "@/lib/tournament/realtimeRooms";

type RouteContext = {
  params: Promise<{ id: string; matchId: string }>;
};

const TERMINAL_MATCH_STATUSES = new Set([
  "completed",
  "walkover",
  "void",
  "cancelled",
]);

function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function authenticateUser(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url || !anonKey) {
    return {
      user: null,
      error: "Server auth is not configured.",
    };
  }

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) {
    return { user: null, error: "Invalid or expired session." };
  }

  return { user: data.user, error: null };
}

async function recordPresenceForParticipant(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string,
  userId: string,
  entryOne: TournamentEntryRef,
  entryTwo: TournamentEntryRef
): Promise<void> {
  const { data: freshMatch, error } = await admin
    .from("tournament_matches")
    .select(
      "id, entry_one_id, entry_two_id, entry_one_present_at, entry_two_present_at, opponent_join_by"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (error || !freshMatch) {
    console.warn(
      `[tournament room] presence skipped for match ${matchId}:`,
      error?.message ?? "match not found"
    );
    return;
  }

  const result = await recordTournamentMatchPresence({
    admin,
    matchId,
    userId,
    match: freshMatch,
    entryOne,
    entryTwo,
  });

  if (!result.ok && result.reason === "db_error") {
    console.warn(
      `[tournament room] presence failed for match ${matchId}:`,
      result.error
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: tournamentId, matchId } = await context.params;

    if (!tournamentId || !matchId) {
      return NextResponse.json(
        { error: "Missing tournament or match id." },
        { status: 400 }
      );
    }

    const accessToken = getBearerToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { user, error: authError } = await authenticateUser(accessToken);
    if (!user) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized." },
        { status: 401 }
      );
    }

    const admin = createAdminClient();

    const { data: tournament, error: tournamentError } = await admin
      .from("tournaments")
      .select("id, status, rounds_per_match")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tournamentError) {
      return NextResponse.json(
        { error: tournamentError.message },
        { status: 500 }
      );
    }

    if (!tournament) {
      return NextResponse.json(
        { error: "Tournament not found." },
        { status: 404 }
      );
    }

    if (tournament.status !== "in_progress") {
      return NextResponse.json(
        { error: "Tournament is not in progress." },
        { status: 409 }
      );
    }

    const { data: match, error: matchError } = await admin
      .from("tournament_matches")
      .select(
        "id, tournament_id, entry_one_id, entry_two_id, room_code, status, winner_entry_id"
      )
      .eq("id", matchId)
      .eq("tournament_id", tournamentId)
      .maybeSingle();

    if (matchError) {
      return NextResponse.json({ error: matchError.message }, { status: 500 });
    }

    if (!match) {
      return NextResponse.json({ error: "Match not found." }, { status: 404 });
    }

    if (TERMINAL_MATCH_STATUSES.has(match.status)) {
      return NextResponse.json(
        { error: "This match is already finished." },
        { status: 409 }
      );
    }

    if (match.winner_entry_id) {
      return NextResponse.json(
        { error: "This match already has a winner." },
        { status: 409 }
      );
    }

    if (!match.entry_one_id || !match.entry_two_id) {
      return NextResponse.json(
        { error: "Both players must be assigned before opening a room." },
        { status: 409 }
      );
    }

    const entryIds = [match.entry_one_id, match.entry_two_id];

    const { data: entryRows, error: entriesError } = await admin
      .from("tournament_entries")
      .select("id, user_id, status")
      .in("id", entryIds);

    if (entriesError) {
      return NextResponse.json({ error: entriesError.message }, { status: 500 });
    }

    if (!entryRows || entryRows.length !== 2) {
      return NextResponse.json(
        { error: "Could not resolve tournament entries for this match." },
        { status: 500 }
      );
    }

    const entryById = new Map(entryRows.map((row) => [row.id, row]));
    const entryOne = entryById.get(match.entry_one_id);
    const entryTwo = entryById.get(match.entry_two_id);

    if (!entryOne || !entryTwo) {
      return NextResponse.json(
        { error: "Could not resolve tournament entries for this match." },
        { status: 500 }
      );
    }

    for (const entry of [entryOne, entryTwo]) {
      if (entry.status === "withdrawn") {
        return NextResponse.json(
          { error: "A participant has withdrawn from this match." },
          { status: 409 }
        );
      }
    }

    const allowedPlayerIds = [entryOne.user_id, entryTwo.user_id];
    const isParticipant = allowedPlayerIds.includes(user.id);

    if (!isParticipant) {
      return NextResponse.json(
        { error: "Only match participants can open this room." },
        { status: 403 }
      );
    }

    if (match.room_code) {
      await recordPresenceForParticipant(
        admin,
        matchId,
        user.id,
        entryOne,
        entryTwo
      );

      return NextResponse.json({
        roomCode: match.room_code,
        existing: true,
      });
    }

    const realtimeResult = await requestRealtimeTournamentRoom({
      tournamentId,
      tournamentMatchId: matchId,
      entryOne,
      entryTwo,
      admin,
      maxRounds: tournament.rounds_per_match ?? 3,
    });

    if (!realtimeResult.ok) {
      return NextResponse.json(
        { error: realtimeResult.error },
        { status: 502 }
      );
    }

    await recordPresenceForParticipant(
      admin,
      matchId,
      user.id,
      entryOne,
      entryTwo
    );

    return NextResponse.json({
      roomCode: realtimeResult.roomCode,
      existing: realtimeResult.existing && !realtimeResult.persisted,
    });
  } catch (error) {
    console.error(
      "POST /api/tournaments/[id]/matches/[matchId]/room failed:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
