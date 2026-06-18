import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const CANCELLABLE_STATUSES = ["draft", "registration", "check_in"] as const;
type CancellableStatus = (typeof CANCELLABLE_STATUSES)[number];

const LOG = "[TournamentCancel]";

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
    return { user: null, error: "Server auth is not configured." };
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
      `${LOG} attempt tournamentId=${tournamentId} userId=${user.id}`
    );

    const admin = createAdminClient();

    const { data: tournament, error: tournamentError } = await admin
      .from("tournaments")
      .select("id, created_by, status")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tournamentError) {
      console.warn(
        `${LOG} rejected tournamentId=${tournamentId} reason=db_error message=${tournamentError.message}`
      );
      return NextResponse.json(
        { error: "Failed to fetch tournament." },
        { status: 500 }
      );
    }

    if (!tournament) {
      console.warn(
        `${LOG} rejected tournamentId=${tournamentId} reason=not_found`
      );
      return NextResponse.json(
        { error: "Tournament not found." },
        { status: 404 }
      );
    }

    if (tournament.created_by !== user.id) {
      console.warn(
        `${LOG} rejected tournamentId=${tournamentId} reason=not_creator userId=${user.id}`
      );
      return NextResponse.json(
        { error: "Only the tournament creator can cancel this tournament." },
        { status: 403 }
      );
    }

    if (!CANCELLABLE_STATUSES.includes(tournament.status as CancellableStatus)) {
      console.warn(
        `${LOG} rejected tournamentId=${tournamentId} reason=wrong_status status=${tournament.status}`
      );
      return NextResponse.json(
        { error: "Tournament cannot be cancelled once it has started." },
        { status: 409 }
      );
    }

    // Cancel is only allowed while fewer than 2 active players are registered.
    // Once there are enough players to start the bracket, the host should start
    // rather than cancel — this matches the beta policy and prevents a host from
    // accidentally destroying a tournament players have already joined.
    const { count: rawCount, error: countError } = await admin
      .from("tournament_entries")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "checked_in"]);

    if (countError) {
      console.warn(
        `${LOG} rejected tournamentId=${tournamentId} reason=count_error message=${countError.message}`
      );
      return NextResponse.json(
        { error: "Failed to check player count." },
        { status: 500 }
      );
    }

    const activeCount = rawCount ?? 0;

    if (activeCount >= 2) {
      console.warn(
        `${LOG} rejected tournamentId=${tournamentId} reason=enough_players activeCount=${activeCount}`
      );
      return NextResponse.json(
        {
          error: `Cannot cancel — ${activeCount} players are registered. Start the bracket, or wait for players to withdraw first.`,
        },
        { status: 409 }
      );
    }

    // Use service-role client so the lifecycle trigger allows the status change.
    const { error: updateError } = await admin
      .from("tournaments")
      .update({ status: "cancelled" })
      .eq("id", tournamentId)
      .eq("created_by", user.id)
      .in("status", [...CANCELLABLE_STATUSES]);

    if (updateError) {
      console.warn(
        `${LOG} rejected tournamentId=${tournamentId} reason=update_failed message=${updateError.message}`
      );
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    console.info(
      `${LOG} success tournamentId=${tournamentId} userId=${user.id}`
    );

    return NextResponse.json({ ok: true, tournamentId });
  } catch (error) {
    console.error("POST /api/tournaments/[id]/cancel failed:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
