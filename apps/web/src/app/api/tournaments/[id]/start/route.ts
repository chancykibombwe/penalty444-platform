import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bracketSlotKey,
  generateSingleEliminationBracket,
  getParentSlot,
  getTotalRounds,
  isPowerOfTwo,
} from "@/lib/tournament/bracket";

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

    const admin = createAdminClient();

    const { data: tournament, error: tournamentError } = await admin
      .from("tournaments")
      .select("id, created_by, status")
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

    if (tournament.created_by !== user.id) {
      return NextResponse.json(
        { error: "Only the tournament creator can start the bracket." },
        { status: 403 }
      );
    }

    if (tournament.status !== "check_in") {
      return NextResponse.json(
        { error: "Tournament must be in check-in status before starting." },
        { status: 409 }
      );
    }

    const { count: existingMatchCount, error: matchCountError } = await admin
      .from("tournament_matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId);

    if (matchCountError) {
      return NextResponse.json(
        { error: matchCountError.message },
        { status: 500 }
      );
    }

    if ((existingMatchCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "Bracket already exists for this tournament." },
        { status: 409 }
      );
    }

    const { data: checkedInRows, error: entriesError } = await admin
      .from("tournament_entries")
      .select("id, checked_in_at")
      .eq("tournament_id", tournamentId)
      .eq("status", "checked_in")
      .order("checked_in_at", { ascending: true });

    if (entriesError) {
      return NextResponse.json({ error: entriesError.message }, { status: 500 });
    }

    const checkedInCount = checkedInRows?.length ?? 0;

    if (!isPowerOfTwo(checkedInCount)) {
      return NextResponse.json(
        {
          error: `Need a power-of-two number of checked-in players (2, 4, 8, …). Currently: ${checkedInCount}.`,
        },
        { status: 400 }
      );
    }

    const entryIds = (checkedInRows ?? []).map((row) => row.id);

    let drafts;
    try {
      drafts = generateSingleEliminationBracket(entryIds);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Bracket generation failed.",
        },
        { status: 400 }
      );
    }

    const { data: insertedRows, error: insertError } = await admin
      .from("tournament_matches")
      .insert(
        drafts.map((draft) => ({
          tournament_id: tournamentId,
          round_number: draft.round_number,
          slot_index: draft.slot_index,
          entry_one_id: draft.entry_one_id,
          entry_two_id: draft.entry_two_id,
          status: draft.status,
        }))
      )
      .select("id, round_number, slot_index");

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    if (!insertedRows?.length) {
      return NextResponse.json(
        { error: "No bracket rows were created." },
        { status: 500 }
      );
    }

    const idBySlot = new Map<string, string>();
    for (const row of insertedRows) {
      idBySlot.set(bracketSlotKey(row.round_number, row.slot_index), row.id);
    }

    const totalRounds = getTotalRounds(checkedInCount);

    for (const draft of drafts) {
      if (draft.round_number >= totalRounds) continue;

      const parent = getParentSlot(draft.round_number, draft.slot_index);
      const parentId = idBySlot.get(
        bracketSlotKey(parent.round_number, parent.slot_index)
      );
      const matchId = idBySlot.get(
        bracketSlotKey(draft.round_number, draft.slot_index)
      );

      if (!parentId || !matchId) {
        return NextResponse.json(
          {
            error:
              "Failed to link bracket rounds. Partial bracket may exist; contact support.",
          },
          { status: 500 }
        );
      }

      const { error: linkError } = await admin
        .from("tournament_matches")
        .update({ next_match_id: parentId })
        .eq("id", matchId);

      if (linkError) {
        return NextResponse.json({ error: linkError.message }, { status: 500 });
      }
    }

    const { data: updatedTournament, error: statusError } = await admin
      .from("tournaments")
      .update({ status: "in_progress" })
      .eq("id", tournamentId)
      .eq("status", "check_in")
      .select("id")
      .maybeSingle();

    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 });
    }

    if (!updatedTournament) {
      return NextResponse.json(
        {
          error:
            "Bracket was created but tournament status could not be updated. It may have already started.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      tournamentId,
      matchCount: insertedRows.length,
      playerCount: checkedInCount,
    });
  } catch (error) {
    console.error("POST /api/tournaments/[id]/start failed:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
