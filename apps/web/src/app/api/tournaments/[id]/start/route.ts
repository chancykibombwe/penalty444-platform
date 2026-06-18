import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { startTournament } from "@/lib/tournament/startTournament";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
    const { id: tournamentId } = await context.params;

    if (!tournamentId) {
      return NextResponse.json(
        { error: "Missing tournament id." },
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

    console.info(
      `[TournamentStart] attempt tournamentId=${tournamentId} userId=${user.id}`
    );

    const result = await startTournament({
      tournamentId,
      requestedByUserId: user.id,
      requireCreator: true,
      source: "manual",
    });

    if (!result.ok) {
      console.warn(
        `[TournamentStart] rejected tournamentId=${tournamentId} status=${result.status} reason=${result.error}`
      );
      return NextResponse.json(
        {
          error: result.error,
          ...(result.rollbackFailed ? { rollbackFailed: true } : {}),
          ...(result.detail ? { detail: result.detail } : {}),
        },
        { status: result.status }
      );
    }

    console.info(
      `[TournamentStart] success tournamentId=${result.tournamentId} matchCount=${result.matchCount} playerCount=${result.playerCount}`
    );

    return NextResponse.json({
      ok: true,
      tournamentId: result.tournamentId,
      matchCount: result.matchCount,
      playerCount: result.playerCount,
    });
  } catch (error) {
    console.error("POST /api/tournaments/[id]/start failed:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
