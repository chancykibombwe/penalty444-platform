import type { SupabaseClient } from "@supabase/supabase-js";
import { computeOpponentJoinBy } from "@/lib/tournament/deadlines";

export type TournamentEntryRef = {
  id: string;
  user_id: string;
};

export type TournamentMatchPresenceRef = {
  id: string;
  entry_one_id: string | null;
  entry_two_id: string | null;
  entry_one_present_at: string | null;
  entry_two_present_at: string | null;
  opponent_join_by: string | null;
};

export type RecordTournamentMatchPresenceParams = {
  admin: SupabaseClient;
  matchId: string;
  userId: string;
  match: TournamentMatchPresenceRef;
  entryOne: TournamentEntryRef;
  entryTwo: TournamentEntryRef;
};

export type RecordTournamentMatchPresenceResult =
  | { ok: true; recorded: boolean }
  | { ok: false; reason: "not_participant" | "db_error"; error?: string };

/**
 * Marks the authenticated participant as present for a match (idempotent).
 * Sets opponent_join_by when the first side appears.
 */
export async function recordTournamentMatchPresence({
  admin,
  matchId,
  userId,
  match,
  entryOne,
  entryTwo,
}: RecordTournamentMatchPresenceParams): Promise<RecordTournamentMatchPresenceResult> {
  const isEntryOne = userId === entryOne.user_id;
  const isEntryTwo = userId === entryTwo.user_id;

  if (!isEntryOne && !isEntryTwo) {
    return { ok: false, reason: "not_participant" };
  }

  const presentColumn = isEntryOne
    ? "entry_one_present_at"
    : "entry_two_present_at";
  const hadAnyPresence = Boolean(
    match.entry_one_present_at ?? match.entry_two_present_at
  );
  const alreadyPresent = isEntryOne
    ? Boolean(match.entry_one_present_at)
    : Boolean(match.entry_two_present_at);

  const now = new Date().toISOString();
  let recorded = false;

  if (!alreadyPresent) {
    const { error: presentError } = await admin
      .from("tournament_matches")
      .update({ [presentColumn]: now })
      .eq("id", matchId)
      .is(presentColumn, null);

    if (presentError) {
      return { ok: false, reason: "db_error", error: presentError.message };
    }

    recorded = true;
  }

  if (!hadAnyPresence && !match.opponent_join_by) {
    const { error: deadlineError } = await admin
      .from("tournament_matches")
      .update({ opponent_join_by: computeOpponentJoinBy() })
      .eq("id", matchId)
      .is("opponent_join_by", null);

    if (deadlineError) {
      return { ok: false, reason: "db_error", error: deadlineError.message };
    }
  }

  return { ok: true, recorded };
}
