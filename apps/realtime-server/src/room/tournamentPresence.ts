import { supabase } from "../config";
import type { Room } from "../types/room";

const DEFAULT_OPPONENT_JOIN_MS = 5 * 60 * 1000;

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const TOURNAMENT_OPPONENT_JOIN_MS =
  parsePositiveInt(process.env.TOURNAMENT_OPPONENT_JOIN_MS) ??
  DEFAULT_OPPONENT_JOIN_MS;

/**
 * Idempotently records player presence for a tournament match when player:present fires.
 * Sets entry_one_present_at or entry_two_present_at and, on the first presence,
 * sets opponent_join_by to now + TOURNAMENT_OPPONENT_JOIN_MS.
 *
 * Fire-and-forget: never throws, logs errors instead.
 */
export async function recordTournamentPresenceIfNeeded(
  room: Room,
  playerId: string
): Promise<void> {
  if (!room.tournamentMatchId || !supabase) return;

  try {
    const { data: match, error: matchError } = await supabase
      .from("tournament_matches")
      .select(
        "id, entry_one_id, entry_two_id, entry_one_present_at, entry_two_present_at, opponent_join_by"
      )
      .eq("id", room.tournamentMatchId)
      .maybeSingle();

    if (matchError || !match) {
      if (matchError) {
        console.error(
          `[TournamentPresence] fetch failed matchId=${room.tournamentMatchId}`,
          matchError.message
        );
      }
      return;
    }

    if (!match.entry_one_id || !match.entry_two_id) return;

    const { data: entries, error: entriesError } = await supabase
      .from("tournament_entries")
      .select("id, user_id")
      .in("id", [match.entry_one_id, match.entry_two_id]);

    if (entriesError || !entries || entries.length !== 2) return;

    const entryById = new Map(entries.map((e) => [e.id, e]));
    const entryOne = entryById.get(match.entry_one_id);
    const entryTwo = entryById.get(match.entry_two_id);

    if (!entryOne || !entryTwo) return;

    const isEntryOne = playerId === entryOne.user_id;
    const isEntryTwo = playerId === entryTwo.user_id;

    if (!isEntryOne && !isEntryTwo) return;

    const presentColumn = isEntryOne
      ? "entry_one_present_at"
      : "entry_two_present_at";
    const alreadyPresent = isEntryOne
      ? Boolean(match.entry_one_present_at)
      : Boolean(match.entry_two_present_at);

    const hadAnyPresence = Boolean(
      match.entry_one_present_at ?? match.entry_two_present_at
    );

    const now = new Date().toISOString();

    if (!alreadyPresent) {
      const { error: updateError } = await supabase
        .from("tournament_matches")
        .update({ [presentColumn]: now })
        .eq("id", room.tournamentMatchId)
        .is(presentColumn, null);

      if (updateError) {
        console.error(
          `[TournamentPresence] update ${presentColumn} failed matchId=${room.tournamentMatchId}`,
          updateError.message
        );
        return;
      }

      console.log(
        `[TournamentPresence] recorded playerId=${playerId} matchId=${room.tournamentMatchId} column=${presentColumn}`
      );
    }

    if (!hadAnyPresence && !match.opponent_join_by) {
      const deadline = new Date(
        Date.now() + TOURNAMENT_OPPONENT_JOIN_MS
      ).toISOString();

      const { error: deadlineError } = await supabase
        .from("tournament_matches")
        .update({ opponent_join_by: deadline })
        .eq("id", room.tournamentMatchId)
        .is("opponent_join_by", null);

      if (deadlineError) {
        console.error(
          `[TournamentPresence] opponent_join_by update failed matchId=${room.tournamentMatchId}`,
          deadlineError.message
        );
        return;
      }

      console.log(
        `[TournamentPresence] opponent_join_by set matchId=${room.tournamentMatchId} deadline=${deadline}`
      );
    }
  } catch (err) {
    console.error("[TournamentPresence] unexpected error:", err);
  }
}
