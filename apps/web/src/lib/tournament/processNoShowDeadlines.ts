import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { propagateVoidOrWalkoverFromMatch } from "@/lib/tournament/advancement";

const MAX_NO_SHOWS_PER_TICK = 50;

export type NoShowProcessingSummary = {
  processed: number;
  voided: number;
  singleWalkovers: number;
  walkoversCreated: number;
  tournamentsCompleted: number;
  failed: { matchId: string; error: string }[];
};

type SingleNoShowCandidate = {
  id: string;
  tournament_id: string;
  entry_one_id: string | null;
  entry_two_id: string | null;
  entry_one_present_at: string | null;
  entry_two_present_at: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function hasExactlyOnePresent(row: SingleNoShowCandidate): boolean {
  const one = row.entry_one_present_at !== null;
  const two = row.entry_two_present_at !== null;
  return one !== two;
}

function presentWinnerEntryId(row: SingleNoShowCandidate): string | null {
  if (row.entry_one_present_at && !row.entry_two_present_at) {
    return row.entry_one_id;
  }
  if (row.entry_two_present_at && !row.entry_one_present_at) {
    return row.entry_two_id;
  }
  return null;
}

async function processDoubleNoShowVoids(
  admin: SupabaseClient,
  summary: NoShowProcessingSummary
): Promise<void> {
  const now = nowIso();

  const { data: overdue, error: queryError } = await admin
    .from("tournament_matches")
    .select("id, tournament_id")
    .eq("status", "ready")
    .not("play_by", "is", null)
    .lte("play_by", now)
    .is("no_show_processed_at", null)
    .is("room_code", null)
    .order("play_by", { ascending: true })
    .limit(MAX_NO_SHOWS_PER_TICK);

  if (queryError) {
    summary.failed.push({ matchId: "*", error: queryError.message });
    return;
  }

  if (!overdue?.length) {
    return;
  }

  for (const row of overdue) {
    const completedAt = nowIso();

    try {
      const { data: voidedRow, error: voidError } = await admin
        .from("tournament_matches")
        .update({
          status: "void",
          winner_entry_id: null,
          completed_at: completedAt,
          no_show_processed_at: completedAt,
        })
        .eq("id", row.id)
        .eq("status", "ready")
        .is("no_show_processed_at", null)
        .is("room_code", null)
        .select("id")
        .maybeSingle();

      if (voidError) {
        summary.failed.push({ matchId: row.id, error: voidError.message });
        continue;
      }

      if (!voidedRow) {
        continue;
      }

      summary.voided += 1;
      summary.processed += 1;

      const propagation = await propagateVoidOrWalkoverFromMatch(admin, row.id);
      summary.walkoversCreated += propagation.walkoversCreated;
      summary.tournamentsCompleted += propagation.tournamentsCompleted;
    } catch (error) {
      summary.failed.push({
        matchId: row.id,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }
}

async function processSingleNoShowWalkovers(
  admin: SupabaseClient,
  summary: NoShowProcessingSummary,
  now: string
): Promise<void> {
  const { data: candidates, error: queryError } = await admin
    .from("tournament_matches")
    .select(
      "id, tournament_id, entry_one_id, entry_two_id, entry_one_present_at, entry_two_present_at"
    )
    .eq("status", "in_progress")
    .not("room_code", "is", null)
    .not("opponent_join_by", "is", null)
    .lte("opponent_join_by", now)
    .is("no_show_processed_at", null)
    .is("winner_entry_id", null)
    .order("opponent_join_by", { ascending: true })
    .limit(MAX_NO_SHOWS_PER_TICK);

  if (queryError) {
    summary.failed.push({ matchId: "*", error: queryError.message });
    return;
  }

  const overdue = (candidates ?? []).filter(hasExactlyOnePresent);

  for (const row of overdue) {
    const winnerEntryId = presentWinnerEntryId(row);

    if (!winnerEntryId) {
      continue;
    }

    const completedAt = nowIso();

    try {
      const { data: walkoverRow, error: walkoverError } = await admin
        .from("tournament_matches")
        .update({
          status: "walkover",
          winner_entry_id: winnerEntryId,
          completed_at: completedAt,
          no_show_processed_at: completedAt,
        })
        .eq("id", row.id)
        .eq("status", "in_progress")
        .is("no_show_processed_at", null)
        .is("winner_entry_id", null)
        .select(
          "id, tournament_id, entry_one_id, entry_two_id, entry_one_present_at, entry_two_present_at"
        )
        .maybeSingle();

      if (walkoverError) {
        summary.failed.push({ matchId: row.id, error: walkoverError.message });
        continue;
      }

      if (!walkoverRow || !hasExactlyOnePresent(walkoverRow)) {
        continue;
      }

      summary.singleWalkovers += 1;
      summary.processed += 1;

      const propagation = await propagateVoidOrWalkoverFromMatch(admin, row.id);
      summary.walkoversCreated += propagation.walkoversCreated;
      summary.tournamentsCompleted += propagation.tournamentsCompleted;
    } catch (error) {
      summary.failed.push({
        matchId: row.id,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }
}

/**
 * Phase 5A: double no-show (ready, no room) → void.
 * Phase 5B: single no-show (in_progress, one presence) → walkover.
 */
export async function processNoShowDeadlines(
  admin: SupabaseClient = createAdminClient()
): Promise<NoShowProcessingSummary> {
  const summary: NoShowProcessingSummary = {
    processed: 0,
    voided: 0,
    singleWalkovers: 0,
    walkoversCreated: 0,
    tournamentsCompleted: 0,
    failed: [],
  };

  const now = nowIso();

  await processDoubleNoShowVoids(admin, summary);
  await processSingleNoShowWalkovers(admin, summary, now);

  return summary;
}
