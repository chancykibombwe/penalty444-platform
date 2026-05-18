import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { propagateVoidOrWalkoverFromMatch } from "@/lib/tournament/advancement";

const MAX_NO_SHOWS_PER_TICK = 50;

export type NoShowProcessingSummary = {
  processed: number;
  voided: number;
  walkoversCreated: number;
  tournamentsCompleted: number;
  failed: { matchId: string; error: string }[];
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Marks overdue ready matches (nobody opened the room) as void and propagates the bracket.
 */
export async function processNoShowDeadlines(
  admin: SupabaseClient = createAdminClient()
): Promise<NoShowProcessingSummary> {
  const summary: NoShowProcessingSummary = {
    processed: 0,
    voided: 0,
    walkoversCreated: 0,
    tournamentsCompleted: 0,
    failed: [],
  };

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
    return summary;
  }

  if (!overdue?.length) {
    return summary;
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

  return summary;
}
