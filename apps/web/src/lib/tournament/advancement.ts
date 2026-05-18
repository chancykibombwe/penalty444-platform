import type { SupabaseClient } from "@supabase/supabase-js";
import { computePlayBy } from "@/lib/tournament/deadlines";
import { autoCreateRealtimeRoomForReadyMatch } from "@/lib/tournament/realtimeRooms";

const TERMINAL_MATCH_STATUSES = new Set([
  "completed",
  "walkover",
  "void",
  "cancelled",
]);

const WINNER_FEEDER_STATUSES = new Set(["completed", "walkover"]);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_MATCH_STATUSES.has(status);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Writes the child winner into the parent feeder column (slot_index parity).
 * Idempotent: only fills a null feeder; never overwrites a different entry.
 */
export async function applyWinnerToParent(
  admin: SupabaseClient,
  childMatchId: string
): Promise<boolean> {
  const { data: child, error: childError } = await admin
    .from("tournament_matches")
    .select(
      "id, tournament_id, slot_index, status, winner_entry_id, next_match_id"
    )
    .eq("id", childMatchId)
    .maybeSingle();

  if (childError || !child) {
    return false;
  }

  if (!child.next_match_id || !child.winner_entry_id) {
    return false;
  }

  if (!WINNER_FEEDER_STATUSES.has(child.status)) {
    return false;
  }

  const { data: parent, error: parentError } = await admin
    .from("tournament_matches")
    .select("id, entry_one_id, entry_two_id, status")
    .eq("id", child.next_match_id)
    .maybeSingle();

  if (parentError || !parent) {
    return false;
  }

  if (isTerminalStatus(parent.status)) {
    return false;
  }

  const feederIsEntryOne = child.slot_index % 2 === 0;
  const existingFeeder = feederIsEntryOne
    ? parent.entry_one_id
    : parent.entry_two_id;

  if (existingFeeder) {
    return existingFeeder === child.winner_entry_id;
  }

  const feederPatch = feederIsEntryOne
    ? { entry_one_id: child.winner_entry_id }
    : { entry_two_id: child.winner_entry_id };

  let query = admin
    .from("tournament_matches")
    .update(feederPatch)
    .eq("id", parent.id)
    .in("status", ["pending", "ready"]);

  query = feederIsEntryOne
    ? query.is("entry_one_id", null)
    : query.is("entry_two_id", null);

  const { error: feederError } = await query;

  return !feederError;
}

/**
 * After both child slots are terminal, derive parent status from feeders.
 */
export async function reconcileParentMatch(
  admin: SupabaseClient,
  parentId: string
): Promise<{ changed: boolean; walkoverCreated: boolean; voidCreated: boolean }> {
  const { data: parent, error: parentError } = await admin
    .from("tournament_matches")
    .select(
      "id, tournament_id, entry_one_id, entry_two_id, status, winner_entry_id, next_match_id"
    )
    .eq("id", parentId)
    .maybeSingle();

  if (parentError || !parent) {
    return { changed: false, walkoverCreated: false, voidCreated: false };
  }

  if (isTerminalStatus(parent.status)) {
    return { changed: false, walkoverCreated: false, voidCreated: false };
  }

  const { data: children, error: childrenError } = await admin
    .from("tournament_matches")
    .select("id, status, winner_entry_id")
    .eq("next_match_id", parentId);

  if (childrenError || !children?.length) {
    return { changed: false, walkoverCreated: false, voidCreated: false };
  }

  if (children.length < 2) {
    return { changed: false, walkoverCreated: false, voidCreated: false };
  }

  if (!children.every((child) => isTerminalStatus(child.status))) {
    return { changed: false, walkoverCreated: false, voidCreated: false };
  }

  for (const child of children) {
    if (WINNER_FEEDER_STATUSES.has(child.status)) {
      await applyWinnerToParent(admin, child.id);
    }
  }

  const { data: parentAfter, error: reloadError } = await admin
    .from("tournament_matches")
    .select("id, entry_one_id, entry_two_id, status, winner_entry_id")
    .eq("id", parentId)
    .maybeSingle();

  if (reloadError || !parentAfter || isTerminalStatus(parentAfter.status)) {
    return { changed: false, walkoverCreated: false, voidCreated: false };
  }

  const entryOneId = parentAfter.entry_one_id;
  const entryTwoId = parentAfter.entry_two_id;
  const hasOne = entryOneId !== null;
  const hasTwo = entryTwoId !== null;
  const completedAt = nowIso();

  if (hasOne && hasTwo) {
    if (parentAfter.status === "ready") {
      return { changed: false, walkoverCreated: false, voidCreated: false };
    }

    const { data: readyRow, error: readyError } = await admin
      .from("tournament_matches")
      .update({
        status: "ready",
        play_by: computePlayBy(),
        winner_entry_id: null,
      })
      .eq("id", parentId)
      .in("status", ["pending"])
      .select("id")
      .maybeSingle();

    const becameReady = Boolean(readyRow) && !readyError;

    if (becameReady) {
      await autoCreateRealtimeRoomForReadyMatch({
        admin,
        tournamentId: parent.tournament_id,
        matchId: parentId,
        logPrefix: "[tournament advancement] rooms",
      });
    }

    return {
      changed: becameReady,
      walkoverCreated: false,
      voidCreated: false,
    };
  }

  if (hasOne && !hasTwo) {
    const { data: walkoverRow, error: walkoverError } = await admin
      .from("tournament_matches")
      .update({
        status: "walkover",
        winner_entry_id: entryOneId,
        completed_at: completedAt,
      })
      .eq("id", parentId)
      .in("status", ["pending", "ready"])
      .is("winner_entry_id", null)
      .select("id")
      .maybeSingle();

    return {
      changed: Boolean(walkoverRow) && !walkoverError,
      walkoverCreated: Boolean(walkoverRow),
      voidCreated: false,
    };
  }

  if (!hasOne && hasTwo) {
    const { data: walkoverRow, error: walkoverError } = await admin
      .from("tournament_matches")
      .update({
        status: "walkover",
        winner_entry_id: entryTwoId,
        completed_at: completedAt,
      })
      .eq("id", parentId)
      .in("status", ["pending", "ready"])
      .is("winner_entry_id", null)
      .select("id")
      .maybeSingle();

    return {
      changed: Boolean(walkoverRow) && !walkoverError,
      walkoverCreated: Boolean(walkoverRow),
      voidCreated: false,
    };
  }

  const { data: voidRow, error: voidError } = await admin
    .from("tournament_matches")
    .update({
      status: "void",
      winner_entry_id: null,
      completed_at: completedAt,
    })
    .eq("id", parentId)
    .in("status", ["pending", "ready"])
    .is("winner_entry_id", null)
    .select("id")
    .maybeSingle();

  return {
    changed: Boolean(voidRow) && !voidError,
    walkoverCreated: false,
    voidCreated: Boolean(voidRow),
  };
}

/**
 * Completes the tournament when the final slot is terminal.
 */
export async function maybeCompleteTournament(
  admin: SupabaseClient,
  tournamentId: string
): Promise<boolean> {
  const { data: tournament, error: tournamentError } = await admin
    .from("tournaments")
    .select("id, status")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError || !tournament || tournament.status !== "in_progress") {
    return false;
  }

  const { data: finals, error: finalError } = await admin
    .from("tournament_matches")
    .select("id, status, winner_entry_id")
    .eq("tournament_id", tournamentId)
    .is("next_match_id", null);

  if (finalError || !finals?.length) {
    return false;
  }

  const finalMatch = finals[0];
  if (!isTerminalStatus(finalMatch.status)) {
    return false;
  }

  const completedAt = nowIso();

  if (finalMatch.status === "void") {
    const { data: updated, error: updateError } = await admin
      .from("tournaments")
      .update({
        status: "completed",
        winner_id: null,
        updated_at: completedAt,
      })
      .eq("id", tournamentId)
      .eq("status", "in_progress")
      .select("id")
      .maybeSingle();

    return Boolean(updated) && !updateError;
  }

  if (
    WINNER_FEEDER_STATUSES.has(finalMatch.status) &&
    finalMatch.winner_entry_id
  ) {
    const { data: entry, error: entryError } = await admin
      .from("tournament_entries")
      .select("user_id")
      .eq("id", finalMatch.winner_entry_id)
      .maybeSingle();

    if (entryError || !entry?.user_id) {
      return false;
    }

    const { data: updated, error: updateError } = await admin
      .from("tournaments")
      .update({
        status: "completed",
        winner_id: entry.user_id,
        updated_at: completedAt,
      })
      .eq("id", tournamentId)
      .eq("status", "in_progress")
      .select("id")
      .maybeSingle();

    return Boolean(updated) && !updateError;
  }

  return false;
}

export type PropagationStats = {
  walkoversCreated: number;
  tournamentsCompleted: number;
};

/**
 * Propagates void / walkover effects up the bracket after a terminal child slot.
 */
export async function propagateVoidOrWalkoverFromMatch(
  admin: SupabaseClient,
  matchId: string
): Promise<PropagationStats> {
  const stats: PropagationStats = {
    walkoversCreated: 0,
    tournamentsCompleted: 0,
  };

  const { data: match, error: matchError } = await admin
    .from("tournament_matches")
    .select(
      "id, tournament_id, status, winner_entry_id, next_match_id, slot_index"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchError || !match) {
    return stats;
  }

  if (!match.next_match_id) {
    if (await maybeCompleteTournament(admin, match.tournament_id)) {
      stats.tournamentsCompleted += 1;
    }
    return stats;
  }

  const parentId = match.next_match_id;

  const { data: children } = await admin
    .from("tournament_matches")
    .select("id, status")
    .eq("next_match_id", parentId);

  for (const child of children ?? []) {
    if (WINNER_FEEDER_STATUSES.has(child.status)) {
      await applyWinnerToParent(admin, child.id);
    }
  }

  const reconcile = await reconcileParentMatch(admin, parentId);
  if (reconcile.walkoverCreated) {
    stats.walkoversCreated += 1;
  }

  const { data: parent } = await admin
    .from("tournament_matches")
    .select("id, status, winner_entry_id, next_match_id, tournament_id")
    .eq("id", parentId)
    .maybeSingle();

  if (!parent) {
    if (await maybeCompleteTournament(admin, match.tournament_id)) {
      stats.tournamentsCompleted += 1;
    }
    return stats;
  }

  if (parent.status === "walkover" && parent.winner_entry_id) {
    await applyWinnerToParent(admin, parent.id);
    const upstream = await propagateVoidOrWalkoverFromMatch(admin, parent.id);
    stats.walkoversCreated += upstream.walkoversCreated;
    stats.tournamentsCompleted += upstream.tournamentsCompleted;
  } else if (parent.status === "void") {
    const upstream = await propagateVoidOrWalkoverFromMatch(admin, parent.id);
    stats.walkoversCreated += upstream.walkoversCreated;
    stats.tournamentsCompleted += upstream.tournamentsCompleted;
  }

  if (await maybeCompleteTournament(admin, match.tournament_id)) {
    stats.tournamentsCompleted += 1;
  }

  return stats;
}
