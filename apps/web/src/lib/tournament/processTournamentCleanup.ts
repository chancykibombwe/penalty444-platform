import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileTournamentCompletion } from "@/lib/tournament/advancement";

/**
 * Auto-cleanup of abandoned tournaments.
 *
 * Rule A — stale `registration` / `check_in`:
 *   starts_at IS NOT NULL
 *   AND starts_at < now() - 30 minutes
 *   AND no tournament_matches exist for the tournament
 *   → cancel.
 *
 * Rule B — stale `in_progress`:
 *   updated_at < now() - 2 hours
 *   AND no tournament_matches with a non-terminal status (pending/ready/in_progress)
 *     have been touched within the last 2 hours
 *   → first attempt reconcileTournamentCompletion(); if still in_progress
 *      after that, cancel.
 *
 * The job is idempotent: every WHERE clause re-asserts the expected status,
 * so the same payload is safe to run every minute.
 */

const STALE_REGISTRATION_AGE_MS = 30 * 60 * 1000; // 30 minutes
const STALE_IN_PROGRESS_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Tournament rows scanned per tick (cap to bound work). */
const MAX_REGISTRATION_CANDIDATES_PER_TICK = 50;
const MAX_IN_PROGRESS_CANDIDATES_PER_TICK = 25;

/** tournament_matches statuses that mean "still alive in the bracket". */
const NON_TERMINAL_MATCH_STATUSES = ["pending", "ready", "in_progress"] as const;

export type TournamentCleanupSummary = {
  staleRegistrationCancelled: number;
  staleInProgressCancelled: number;
  reconciledCompleted: number;
  failed: { tournamentId: string; error: string }[];
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Rule A: cancel registration / check_in tournaments whose scheduled start
 * has passed by >= 30 minutes without ever generating a bracket.
 */
async function cancelStaleRegistrationWindow(
  admin: SupabaseClient,
  summary: TournamentCleanupSummary
): Promise<void> {
  const cutoffIso = new Date(
    Date.now() - STALE_REGISTRATION_AGE_MS
  ).toISOString();

  const { data: candidates, error: selectError } = await admin
    .from("tournaments")
    .select("id")
    .in("status", ["registration", "check_in"])
    .not("starts_at", "is", null)
    .lt("starts_at", cutoffIso)
    .order("starts_at", { ascending: true })
    .limit(MAX_REGISTRATION_CANDIDATES_PER_TICK);

  if (selectError) {
    summary.failed.push({ tournamentId: "*", error: selectError.message });
    return;
  }

  const candidateIds = (candidates ?? []).map((row) => row.id);
  if (candidateIds.length === 0) {
    return;
  }

  // Exclude any candidate that already has at least one tournament_match row;
  // those belong to Rule B / normal bracket flow.
  const { data: matchRows, error: matchError } = await admin
    .from("tournament_matches")
    .select("tournament_id")
    .in("tournament_id", candidateIds);

  if (matchError) {
    summary.failed.push({ tournamentId: "*", error: matchError.message });
    return;
  }

  const idsWithMatches = new Set(
    (matchRows ?? []).map((row) => row.tournament_id)
  );

  const cancelTargets = candidateIds.filter((id) => !idsWithMatches.has(id));
  if (cancelTargets.length === 0) {
    return;
  }

  for (const tournamentId of cancelTargets) {
    try {
      const { data: updated, error: updateError } = await admin
        .from("tournaments")
        .update({ status: "cancelled", updated_at: nowIso() })
        // Re-assert status to stay idempotent if a host just clicked Start.
        .in("status", ["registration", "check_in"])
        .eq("id", tournamentId)
        .select("id")
        .maybeSingle();

      if (updateError) {
        summary.failed.push({ tournamentId, error: updateError.message });
        continue;
      }

      if (updated) {
        summary.staleRegistrationCancelled += 1;
      }
    } catch (error) {
      summary.failed.push({
        tournamentId,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }
}

/**
 * Rule B: reconcile/cancel in_progress tournaments where neither the
 * tournament row nor any live match has been touched for 2+ hours.
 */
async function cancelStaleInProgress(
  admin: SupabaseClient,
  summary: TournamentCleanupSummary
): Promise<void> {
  const cutoffMs = Date.now() - STALE_IN_PROGRESS_AGE_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const { data: candidates, error: selectError } = await admin
    .from("tournaments")
    .select("id, updated_at")
    .eq("status", "in_progress")
    .lt("updated_at", cutoffIso)
    .order("updated_at", { ascending: true })
    .limit(MAX_IN_PROGRESS_CANDIDATES_PER_TICK);

  if (selectError) {
    summary.failed.push({ tournamentId: "*", error: selectError.message });
    return;
  }

  const candidateIds = (candidates ?? []).map((row) => row.id);
  if (candidateIds.length === 0) {
    return;
  }

  // For each candidate, prefer reconciliation. If it remains in_progress
  // AND has no non-terminal match touched within the staleness window,
  // cancel it.
  for (const tournamentId of candidateIds) {
    try {
      let reconciled = false;
      try {
        reconciled = await reconcileTournamentCompletion(admin, tournamentId);
      } catch (reconcileError) {
        summary.failed.push({
          tournamentId,
          error:
            reconcileError instanceof Error
              ? `reconcile: ${reconcileError.message}`
              : "Unknown reconcile error.",
        });
      }

      if (reconciled) {
        summary.reconciledCompleted += 1;
        continue;
      }

      const { data: refreshed, error: refreshError } = await admin
        .from("tournaments")
        .select("id, status, updated_at")
        .eq("id", tournamentId)
        .maybeSingle();

      if (refreshError) {
        summary.failed.push({
          tournamentId,
          error: refreshError.message,
        });
        continue;
      }

      if (!refreshed || refreshed.status !== "in_progress") {
        // reconcile may have moved it to completed; nothing more to do.
        continue;
      }

      const refreshedUpdatedMs = Date.parse(refreshed.updated_at as string);
      if (Number.isFinite(refreshedUpdatedMs) && refreshedUpdatedMs >= cutoffMs) {
        // Tournament row was touched while we worked; skip until next tick.
        continue;
      }

      // Are there any non-terminal matches touched in the staleness window?
      const { data: liveMatches, error: liveError } = await admin
        .from("tournament_matches")
        .select("id, status, updated_at")
        .eq("tournament_id", tournamentId)
        .in("status", [...NON_TERMINAL_MATCH_STATUSES])
        .gte("updated_at", cutoffIso)
        .limit(1);

      if (liveError) {
        summary.failed.push({
          tournamentId,
          error: `liveMatches: ${liveError.message}`,
        });
        continue;
      }

      if (liveMatches && liveMatches.length > 0) {
        // Real activity exists — leave the tournament alone.
        continue;
      }

      const { data: cancelled, error: cancelError } = await admin
        .from("tournaments")
        .update({ status: "cancelled", updated_at: nowIso() })
        // Stay idempotent: only flip rows still claiming in_progress.
        .eq("id", tournamentId)
        .eq("status", "in_progress")
        .lt("updated_at", cutoffIso)
        .select("id")
        .maybeSingle();

      if (cancelError) {
        summary.failed.push({
          tournamentId,
          error: cancelError.message,
        });
        continue;
      }

      if (cancelled) {
        summary.staleInProgressCancelled += 1;
      }
    } catch (error) {
      summary.failed.push({
        tournamentId,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }
}

/**
 * Run Rule A then Rule B. Safe to invoke from the periodic tick handler.
 */
export async function processTournamentCleanup(
  admin: SupabaseClient = createAdminClient()
): Promise<TournamentCleanupSummary> {
  const summary: TournamentCleanupSummary = {
    staleRegistrationCancelled: 0,
    staleInProgressCancelled: 0,
    reconciledCompleted: 0,
    failed: [],
  };

  await cancelStaleRegistrationWindow(admin, summary);
  await cancelStaleInProgress(admin, summary);

  return summary;
}
