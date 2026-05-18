import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordTournamentMatchPresence } from "@/lib/tournament/presence";

type RouteContext = {
  params: Promise<{ id: string; matchId: string }>;
};

const TERMINAL_MATCH_STATUSES = new Set(["completed", "walkover", "void"]);

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
      .select("id")
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

    const { data: match, error: matchError } = await admin
      .from("tournament_matches")
      .select(
        "id, tournament_id, entry_one_id, entry_two_id, room_code, status, entry_one_present_at, entry_two_present_at, opponent_join_by"
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

    if (!match.room_code) {
      return NextResponse.json(
        { error: "Match room is not open yet." },
        { status: 409 }
      );
    }

    if (!match.entry_one_id || !match.entry_two_id) {
      return NextResponse.json(
        { error: "Both players must be assigned for this match." },
        { status: 409 }
      );
    }

    const { data: entryRows, error: entriesError } = await admin
      .from("tournament_entries")
      .select("id, user_id")
      .in("id", [match.entry_one_id, match.entry_two_id]);

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

    const isParticipant =
      user.id === entryOne.user_id || user.id === entryTwo.user_id;

    if (!isParticipant) {
      return NextResponse.json(
        { error: "Only match participants can record presence." },
        { status: 403 }
      );
    }

    const result = await recordTournamentMatchPresence({
      admin,
      matchId,
      userId: user.id,
      match,
      entryOne,
      entryTwo,
    });

    if (!result.ok) {
      if (result.reason === "not_participant") {
        return NextResponse.json(
          { error: "Only match participants can record presence." },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: result.error ?? "Failed to record presence." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "POST /api/tournaments/[id]/matches/[matchId]/presence failed:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
