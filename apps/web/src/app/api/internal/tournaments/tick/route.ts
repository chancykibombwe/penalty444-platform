import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processNoShowDeadlines } from "@/lib/tournament/processNoShowDeadlines";
import { processTournamentCleanup } from "@/lib/tournament/processTournamentCleanup";
import {
  startTournament,
  TOURNAMENT_START_SYSTEM_USER_ID,
} from "@/lib/tournament/startTournament";

const MAX_TOURNAMENTS_PER_TICK = 10;
const CANDIDATE_POOL_LIMIT = 30;

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    return false;
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return false;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 && token === secret;
}

function isDevScheduleSyncAuthorized(request: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  if (process.env.NEXT_PUBLIC_ENABLE_DEV_SCHEDULE_SYNC !== "true") {
    return false;
  }

  return request.headers.get("x-dev-schedule-sync") === "1";
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request) && !isDevScheduleSyncAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: dueCandidates, error: dueError } = await admin
      .from("tournaments")
      .select("id")
      .in("status", ["registration", "check_in"])
      .not("starts_at", "is", null)
      .lte("starts_at", now)
      .order("starts_at", { ascending: true })
      .limit(CANDIDATE_POOL_LIMIT);

    if (dueError) {
      return NextResponse.json({ error: dueError.message }, { status: 500 });
    }

    const candidateIds = (dueCandidates ?? []).map((row) => row.id);

    let checked = 0;
    let started = 0;
    const failed: { tournamentId: string; error: string; status: number }[] =
      [];

    if (candidateIds.length > 0) {
      const { data: matchRows, error: matchError } = await admin
        .from("tournament_matches")
        .select("tournament_id")
        .in("tournament_id", candidateIds);

      if (matchError) {
        return NextResponse.json({ error: matchError.message }, { status: 500 });
      }

      const tournamentIdsWithMatches = new Set(
        (matchRows ?? []).map((row) => row.tournament_id)
      );

      const toProcess = candidateIds
        .filter((id) => !tournamentIdsWithMatches.has(id))
        .slice(0, MAX_TOURNAMENTS_PER_TICK);

      checked = toProcess.length;

      for (const tournamentId of toProcess) {
        const result = await startTournament({
          tournamentId,
          requestedByUserId: TOURNAMENT_START_SYSTEM_USER_ID,
          requireCreator: false,
          source: "scheduled",
          admin,
        });

        if (result.ok) {
          started += 1;
        } else {
          failed.push({
            tournamentId,
            error: result.error,
            status: result.status,
          });
        }
      }
    }

    const noShow = await processNoShowDeadlines(admin);
    const cleanup = await processTournamentCleanup(admin);

    return NextResponse.json({
      ok: true,
      checked,
      started,
      failed,
      noShow,
      cleanup,
    });
  } catch (error) {
    console.error("POST /api/internal/tournaments/tick failed:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

export { POST as GET };
