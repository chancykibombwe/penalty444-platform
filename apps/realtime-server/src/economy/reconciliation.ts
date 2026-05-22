/**
 * Phase 12 — Settlement / escrow reconciliation worker.
 *
 * Safe-to-run-repeatedly recovery layer for the economy. Every pass:
 *
 *   1. Retries `processing` settlements older than the threshold.
 *   2. Detects escrows orphaned by missing rooms / aborted matches.
 *   3. Refunds tournament entries belonging to cancelled tournaments.
 *   4. (Optional) sample-checks wallet balance vs. ledger sum.
 *
 * Every action is:
 *
 *   * Idempotent — re-running the same pass never double-pays or
 *     double-refunds. The deterministic idempotency keys + escrow
 *     status machine + settlement_events unique constraints absorb
 *     duplicates.
 *   * Audit-logged with `[EconomyRecovery]` and `[SettlementRetry]`
 *     prefixes plus an `audit_events` row.
 *   * Conservative — when the worker is unsure, the row goes to
 *     `manual_review`, NOT into a write that moves money.
 *
 * The worker is OFF by default (`ECONOMY_RECONCILIATION_ENABLED=false`)
 * and exposed via `/internal/economy/reconcile`. A future cron / interval
 * scheduler may wire it to a periodic loop.
 */

import { supabase } from "../config";
import { rooms } from "../state/stores";
import { emitAuditEvent } from "./audit";
import { ECONOMY_ENABLED } from "./config";
import type { EscrowRow, EscrowStatus } from "./escrow";
import {
  fetchMatchEscrowsForRoom,
  markEscrowManualReview,
  refundMatchEscrow,
  refundTournamentEntryEscrowByRow,
} from "./escrow";
import { settleMatchEconomy } from "./settlement";

/* ---------------------------------------------------------------------------
 * Tunables
 * --------------------------------------------------------------------------- */

const STUCK_SETTLEMENT_AGE_MS = 5 * 60 * 1000; // 5 min
const PENDING_ESCROW_AGE_MS = 10 * 60 * 1000; // 10 min
const ORPHAN_LOCKED_ESCROW_AGE_MS = 60 * 60 * 1000; // 60 min
const MAX_SETTLEMENT_RETRIES = 3;
const MAX_ROWS_PER_PASS = 100;

/* ---------------------------------------------------------------------------
 * Public summary types
 * --------------------------------------------------------------------------- */

export type StuckSettlementOutcome =
  | "skipped_too_recent"
  | "skipped_no_match_result"
  | "retried_completed"
  | "retried_still_failed"
  | "flagged_manual_review"
  | "skipped_max_retries"
  | "skipped_duplicate"
  | "skipped_terminal";

export type StuckSettlementReport = {
  settlementId: string;
  outcome: StuckSettlementOutcome;
  reason?: string;
};

export type OrphanEscrowOutcome =
  | "refunded"
  | "manual_review"
  | "failed_marked"
  | "skipped";

export type OrphanEscrowReport = {
  escrowId: string;
  outcome: OrphanEscrowOutcome;
  reason: string;
};

export type ReconciliationSummary = {
  ranAt: string;
  checked: number;
  retriedSettlements: number;
  refundedEscrows: number;
  flaggedManualReview: number;
  failed: number;
  details: {
    stuckSettlements: StuckSettlementReport[];
    orphanEscrows: OrphanEscrowReport[];
    cancelledTournaments: Array<{
      tournamentId: string;
      refunded: number;
      failed: number;
    }>;
  };
};

/* ---------------------------------------------------------------------------
 * Single-flight guard
 *
 * Two overlapping reconciliation passes against the same row don't
 * corrupt data (every helper is idempotent) but they waste DB cycles
 * and clutter the audit log. Hold a soft in-memory lock.
 * --------------------------------------------------------------------------- */
let inflight = false;

function emptySummary(): ReconciliationSummary {
  return {
    ranAt: new Date().toISOString(),
    checked: 0,
    retriedSettlements: 0,
    refundedEscrows: 0,
    flaggedManualReview: 0,
    failed: 0,
    details: {
      stuckSettlements: [],
      orphanEscrows: [],
      cancelledTournaments: [],
    },
  };
}

/* ---------------------------------------------------------------------------
 * Top-level entry
 * --------------------------------------------------------------------------- */

export async function reconcileEconomy(): Promise<ReconciliationSummary> {
  const summary = emptySummary();

  if (!ECONOMY_ENABLED) {
    console.log(
      "[EconomyRecovery] reconcileEconomy skipped — ECONOMY_ENABLED=false"
    );
    return summary;
  }
  if (!supabase) {
    console.log("[EconomyRecovery] reconcileEconomy skipped — no supabase");
    return summary;
  }
  if (inflight) {
    console.log(
      "[EconomyRecovery] reconcileEconomy skipped — another pass in flight"
    );
    return summary;
  }

  inflight = true;
  try {
    console.log("[EconomyRecovery] starting reconciliation pass");

    const stuck = await reconcileStuckSettlements();
    summary.details.stuckSettlements = stuck;
    summary.checked += stuck.length;
    summary.retriedSettlements += stuck.filter(
      (r) => r.outcome === "retried_completed"
    ).length;
    summary.flaggedManualReview += stuck.filter(
      (r) => r.outcome === "flagged_manual_review"
    ).length;
    summary.failed += stuck.filter(
      (r) => r.outcome === "retried_still_failed"
    ).length;

    const orphan = await reconcileOrphanEscrows();
    summary.details.orphanEscrows = orphan;
    summary.checked += orphan.length;
    summary.refundedEscrows += orphan.filter(
      (r) => r.outcome === "refunded"
    ).length;
    summary.flaggedManualReview += orphan.filter(
      (r) => r.outcome === "manual_review"
    ).length;

    const tournaments = await reconcileTournamentEscrows();
    summary.details.cancelledTournaments = tournaments;
    summary.refundedEscrows += tournaments.reduce(
      (sum, t) => sum + t.refunded,
      0
    );
    summary.failed += tournaments.reduce((sum, t) => sum + t.failed, 0);
    summary.checked += tournaments.length;

    // Wallet consistency is lightweight (sample only) — see helper.
    const driftCount = await reconcileWalletConsistency();
    summary.flaggedManualReview += driftCount;

    await emitAuditEvent({
      eventType: "economy.reconciliation_completed",
      actorKind: "system",
      referenceType: "reconciliation",
      payload: {
        checked: summary.checked,
        retriedSettlements: summary.retriedSettlements,
        refundedEscrows: summary.refundedEscrows,
        flaggedManualReview: summary.flaggedManualReview,
        failed: summary.failed,
      },
    });

    console.log(
      `[EconomyRecovery] pass complete checked=${summary.checked} ` +
        `retried=${summary.retriedSettlements} refunded=${summary.refundedEscrows} ` +
        `manual=${summary.flaggedManualReview} failed=${summary.failed}`
    );
  } finally {
    inflight = false;
  }

  return summary;
}

/* ---------------------------------------------------------------------------
 * 1. Stuck settlement recovery
 *
 * Targets:
 *   * status='processing' AND created_at < now - 5 min
 *   * status='failed'     AND retry_count < MAX_SETTLEMENT_RETRIES
 *   * status='pending'    AND created_at < now - 5 min  (rare)
 *
 * Skips: completed, reversed, requires_payout, manual_review.
 * --------------------------------------------------------------------------- */

export async function reconcileStuckSettlements(): Promise<
  StuckSettlementReport[]
> {
  if (!supabase) return [];
  const reports: StuckSettlementReport[] = [];

  const cutoff = new Date(Date.now() - STUCK_SETTLEMENT_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from("settlement_events")
    .select(
      "id, scope, room_code, match_instance, tournament_id, settlement_type, status, retry_count, created_at"
    )
    .in("status", ["processing", "failed", "pending"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS_PER_PASS);

  if (error) {
    console.error(
      "[SettlementRetry] failed to fetch stuck settlements:",
      error
    );
    return reports;
  }

  for (const row of data ?? []) {
    const settlementId = row.id as string;
    const scope = row.scope as string;
    const status = row.status as string;
    const retryCount = (row.retry_count as number) ?? 0;

    if (status === "completed" || status === "manual_review") {
      reports.push({ settlementId, outcome: "skipped_terminal" });
      continue;
    }

    if (retryCount >= MAX_SETTLEMENT_RETRIES) {
      await supabase
        .from("settlement_events")
        .update({
          status: "manual_review",
          failure_reason: `max_retries_${retryCount}`,
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", settlementId);
      await emitAuditEvent({
        eventType: "settlement.recovery_failed",
        severity: "critical",
        actorKind: "system",
        referenceType: "settlement",
        referenceId: settlementId,
        payload: { retryCount },
      });
      reports.push({
        settlementId,
        outcome: "skipped_max_retries",
        reason: `retry_count=${retryCount}`,
      });
      continue;
    }

    // Only match scope is auto-retryable in Phase 12.
    if (scope !== "match") {
      reports.push({
        settlementId,
        outcome: "skipped_terminal",
        reason: `scope=${scope}`,
      });
      continue;
    }

    const roomCode = row.room_code as string | null;
    const matchInstance = row.match_instance as number | null;
    if (!roomCode || matchInstance == null) {
      reports.push({
        settlementId,
        outcome: "flagged_manual_review",
        reason: "missing_match_keys",
      });
      await supabase
        .from("settlement_events")
        .update({
          status: "manual_review",
          failure_reason: "missing_match_keys",
        })
        .eq("id", settlementId);
      continue;
    }

    // Confirm match_result exists; if not, the settlement is invalid.
    const { data: matchRow } = await supabase
      .from("match_results")
      .select("room_code, match_instance")
      .eq("room_code", roomCode)
      .eq("match_instance", matchInstance)
      .maybeSingle();
    if (!matchRow) {
      reports.push({
        settlementId,
        outcome: "skipped_no_match_result",
        reason: "no_match_result",
      });
      await emitAuditEvent({
        eventType: "settlement.reconciliation_no_result",
        severity: "warning",
        actorKind: "system",
        referenceType: "settlement",
        referenceId: settlementId,
        payload: { roomCode, matchInstance },
      });
      continue;
    }

    // Bump retry counter BEFORE attempting so concurrent reconcilers
    // see the latest count. Reset settlement status to processing so
    // settleMatchEconomy can re-enter the pipeline.
    await supabase
      .from("settlement_events")
      .update({
        retry_count: retryCount + 1,
        last_retry_at: new Date().toISOString(),
        status: "processing",
        failure_reason: null,
      })
      .eq("id", settlementId);

    await emitAuditEvent({
      eventType: "settlement.retried",
      actorKind: "system",
      referenceType: "settlement",
      referenceId: settlementId,
      payload: { roomCode, matchInstance, retryCount: retryCount + 1 },
    });

    console.log(
      `[SettlementRetry] retrying settlementId=${settlementId} ` +
        `roomCode=${roomCode} mi=${matchInstance} attempt=${retryCount + 1}`
    );

    const result = await settleMatchEconomy({ roomCode, matchInstance });
    if (result.ok === false) {
      await supabase
        .from("settlement_events")
        .update({
          status: "failed",
          failure_reason: result.reason,
        })
        .eq("id", settlementId);
      await emitAuditEvent({
        eventType: "settlement.recovery_failed",
        severity: "error",
        actorKind: "system",
        referenceType: "settlement",
        referenceId: settlementId,
        payload: { roomCode, matchInstance, reason: result.reason },
      });
      reports.push({
        settlementId,
        outcome: "retried_still_failed",
        reason: result.reason,
      });
      continue;
    }

    if (result.alreadyProcessed) {
      reports.push({ settlementId, outcome: "skipped_duplicate" });
    } else {
      await emitAuditEvent({
        eventType: "settlement.recovered",
        actorKind: "system",
        referenceType: "settlement",
        referenceId: settlementId,
        payload: { roomCode, matchInstance },
      });
      reports.push({ settlementId, outcome: "retried_completed" });
    }
  }

  return reports;
}

/* ---------------------------------------------------------------------------
 * 2. Orphan escrow recovery
 *
 * Three buckets:
 *   a) status='pending' AND created_at < now - 10 min
 *        → no ledger debit happened. Mark `failed`. Safe.
 *   b) status='locked' AND scope='match' AND no match_result
 *      AND room NOT in memory AND created_at < now - 60 min
 *        → orphan from a crashed match. Refund + audit.
 *   c) status='locked' AND scope='match' AND no match_result
 *      AND room still in memory (could be a long match)
 *        → leave alone.
 *
 * Anything else weird → manual_review.
 * --------------------------------------------------------------------------- */

export async function reconcileOrphanEscrows(): Promise<OrphanEscrowReport[]> {
  if (!supabase) return [];
  const reports: OrphanEscrowReport[] = [];

  // (a) Stuck pending rows.
  const pendingCutoff = new Date(Date.now() - PENDING_ESCROW_AGE_MS).toISOString();
  const { data: pendingRows } = await supabase
    .from("escrow_locks")
    .select("id, user_id, status, created_at")
    .eq("status", "pending")
    .lt("created_at", pendingCutoff)
    .limit(MAX_ROWS_PER_PASS);

  for (const row of pendingRows ?? []) {
    const escrowId = row.id as string;
    await supabase
      .from("escrow_locks")
      .update({
        status: "failed",
        failure_reason: "pending_timeout",
      })
      .eq("id", escrowId)
      .eq("status", "pending"); // guard against race

    await emitAuditEvent({
      eventType: "escrow.orphan_detected",
      severity: "warning",
      actorKind: "system",
      referenceType: "escrow",
      referenceId: escrowId,
      payload: { reason: "pending_timeout" },
    });
    reports.push({
      escrowId,
      outcome: "failed_marked",
      reason: "pending_timeout",
    });
  }

  // (b) + (c) Locked match escrows with no result.
  const lockedCutoff = new Date(
    Date.now() - ORPHAN_LOCKED_ESCROW_AGE_MS
  ).toISOString();
  const { data: lockedRows } = await supabase
    .from("escrow_locks")
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at, created_at"
    )
    .eq("scope", "match")
    .eq("status", "locked")
    .lt("locked_at", lockedCutoff)
    .limit(MAX_ROWS_PER_PASS);

  for (const row of (lockedRows ?? []) as Array<EscrowRow & { created_at: string }>) {
    const escrowId = row.id;
    const roomCode = row.room_code;
    const matchInstance = row.match_instance;

    if (!roomCode || matchInstance == null) {
      await markEscrowManualReview(escrowId, "missing_match_keys");
      reports.push({
        escrowId,
        outcome: "manual_review",
        reason: "missing_match_keys",
      });
      continue;
    }

    // Is there an authoritative match_result?
    const { data: matchResult } = await supabase
      .from("match_results")
      .select("room_code")
      .eq("room_code", roomCode)
      .eq("match_instance", matchInstance)
      .maybeSingle();

    if (matchResult) {
      // A result exists — the settlement worker handles this case,
      // NOT us. We skip and let the stuck-settlement loop pick it up.
      reports.push({
        escrowId,
        outcome: "skipped",
        reason: "has_result_settlement_owns_it",
      });
      continue;
    }

    // No result. Is the room still in memory? If yes, this might just
    // be a very long match — do not touch.
    if (rooms.has(roomCode)) {
      reports.push({
        escrowId,
        outcome: "skipped",
        reason: "room_still_active",
      });
      continue;
    }

    // No result + no room + old → safely refund this orphan.
    const refund = await refundMatchEscrow({
      userId: row.user_id,
      roomCode,
      matchInstance,
      amountMinor: row.amount_minor,
    });

    if (refund.ok === false) {
      // The refund helper itself flagged a problem (e.g. the row was
      // updated by another worker just now). Send to manual_review.
      if (refund.reason === "escrow_not_found") {
        reports.push({
          escrowId,
          outcome: "skipped",
          reason: "race_already_settled",
        });
        continue;
      }
      await markEscrowManualReview(escrowId, `refund_failed:${refund.reason}`);
      reports.push({
        escrowId,
        outcome: "manual_review",
        reason: refund.reason,
      });
      continue;
    }

    await emitAuditEvent({
      eventType: "escrow.refunded_by_reconciliation",
      severity: "warning",
      actorKind: "system",
      referenceType: "escrow",
      referenceId: escrowId,
      payload: {
        roomCode,
        matchInstance,
        reason: "orphan_no_result_no_room",
      },
    });
    reports.push({
      escrowId,
      outcome: "refunded",
      reason: "orphan_no_result_no_room",
    });
  }

  return reports;
}

/* ---------------------------------------------------------------------------
 * 3. Tournament escrow reconciliation
 *
 * Refund tournament entry escrows for tournaments whose status has
 * transitioned to `cancelled` (or any non-recoverable terminal state).
 * --------------------------------------------------------------------------- */

export async function reconcileTournamentEscrows(): Promise<
  Array<{ tournamentId: string; refunded: number; failed: number }>
> {
  if (!supabase) return [];
  const results: Array<{
    tournamentId: string;
    refunded: number;
    failed: number;
  }> = [];

  // Find tournament IDs that (a) have at least one locked entry escrow,
  // AND (b) the tournament itself is cancelled.
  const { data: rows } = await supabase
    .from("escrow_locks")
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
    )
    .eq("scope", "tournament_entry")
    .in("status", ["locked", "pending"])
    .limit(MAX_ROWS_PER_PASS);

  if (!rows || rows.length === 0) return results;

  const tournamentIds = Array.from(
    new Set(
      (rows as EscrowRow[])
        .map((r) => r.tournament_id)
        .filter((id): id is string => !!id)
    )
  );

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, status")
    .in("id", tournamentIds);

  const cancelledIds = new Set(
    (tournaments ?? [])
      .filter((t) => t.status === "cancelled")
      .map((t) => t.id as string)
  );

  for (const tournamentId of cancelledIds) {
    let refunded = 0;
    let failed = 0;
    const subset = (rows as EscrowRow[]).filter(
      (r) => r.tournament_id === tournamentId
    );

    for (const row of subset) {
      if (row.status === "pending") {
        await supabase
          .from("escrow_locks")
          .update({
            status: "failed",
            failure_reason: "tournament_cancelled",
          })
          .eq("id", row.id);
        continue;
      }
      const result = await refundTournamentEntryEscrowByRow(row);
      if (result.ok === false) {
        failed += 1;
      } else {
        refunded += 1;
      }
    }

    if (refunded > 0 || failed > 0) {
      await emitAuditEvent({
        eventType: "tournament.refund_fanout",
        severity: failed > 0 ? "warning" : "info",
        actorKind: "system",
        referenceType: "tournament",
        referenceId: tournamentId,
        payload: {
          via: "reconciliation",
          refunded,
          failed,
        },
      });
    }
    results.push({ tournamentId, refunded, failed });
  }

  return results;
}

/* ---------------------------------------------------------------------------
 * 4. Wallet consistency (lightweight sample)
 *
 * Picks the N most recently active wallets and checks that
 * available_balance_minor + locked_balance_minor == sum of credits
 * minus debits across wallet_ledger_entries. Any drift is logged and
 * counted; no money moves. Drift > 0 is a hard alarm.
 * --------------------------------------------------------------------------- */

export async function reconcileWalletConsistency(
  sampleSize = 20
): Promise<number> {
  if (!supabase) return 0;

  const { data: walletRows } = await supabase
    .from("wallets")
    .select("user_id, available_balance_minor, locked_balance_minor")
    .order("updated_at", { ascending: false })
    .limit(sampleSize);

  if (!walletRows || walletRows.length === 0) return 0;

  let driftCount = 0;
  for (const wallet of walletRows) {
    const userId = wallet.user_id as string;
    const available = Number(wallet.available_balance_minor ?? 0);
    const locked = Number(wallet.locked_balance_minor ?? 0);

    const { data: ledgerRows } = await supabase
      .from("wallet_ledger_entries")
      .select("amount_minor, direction, pocket")
      .eq("user_id", userId);

    if (!ledgerRows) continue;

    let availableSum = 0;
    let lockedSum = 0;
    for (const entry of ledgerRows) {
      const amount = Number(entry.amount_minor ?? 0);
      const sign = entry.direction === "credit" ? +1 : -1;
      const pocket = entry.pocket as string;
      if (pocket === "available") {
        availableSum += sign * amount;
      } else if (pocket === "locked") {
        lockedSum += sign * amount;
      } else if (pocket === "transfer") {
        // transfer entries move available ↔ locked. The DIRECTION encodes
        // the side that moves. By convention (Phase 10 helpers):
        //   debit  + transfer = available → locked  (escrow lock)
        //   credit + transfer = locked → available  (escrow payout/refund)
        if (entry.direction === "debit") {
          availableSum -= amount;
          lockedSum += amount;
        } else {
          lockedSum -= amount;
          availableSum += amount;
        }
      }
    }

    if (availableSum !== available || lockedSum !== locked) {
      driftCount += 1;
      await emitAuditEvent({
        eventType: "wallet.balance_drift_detected",
        severity: "critical",
        actorKind: "system",
        referenceType: "wallet",
        referenceId: userId,
        payload: {
          walletAvailable: available,
          walletLocked: locked,
          ledgerAvailable: availableSum,
          ledgerLocked: lockedSum,
        },
      });
      console.error(
        `[EconomyRecovery] balance drift userId=${userId} ` +
          `wallet=(${available}/${locked}) ledger=(${availableSum}/${lockedSum})`
      );
    }
  }

  return driftCount;
}

/* ---------------------------------------------------------------------------
 * Query helpers for the inspection endpoints (TASK 7)
 * --------------------------------------------------------------------------- */

export type StuckEscrowSnapshot = {
  id: string;
  userId: string;
  scope: string;
  status: EscrowStatus;
  roomCode: string | null;
  matchInstance: number | null;
  tournamentId: string | null;
  amountMinor: number;
  ageMs: number;
  failureReason: string | null;
};

export async function listStuckEscrows(
  limit = 50
): Promise<StuckEscrowSnapshot[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("escrow_locks")
    .select(
      "id, user_id, scope, status, room_code, match_instance, tournament_id, amount_minor, locked_at, created_at, failure_reason"
    )
    .in("status", ["pending", "locked", "manual_review"])
    .order("created_at", { ascending: true })
    .limit(limit);
  const now = Date.now();
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const created = new Date((r.created_at as string) ?? new Date().toISOString());
    return {
      id: r.id as string,
      userId: r.user_id as string,
      scope: r.scope as string,
      status: r.status as EscrowStatus,
      roomCode: (r.room_code as string | null) ?? null,
      matchInstance: (r.match_instance as number | null) ?? null,
      tournamentId: (r.tournament_id as string | null) ?? null,
      amountMinor: Number(r.amount_minor ?? 0),
      ageMs: now - created.getTime(),
      failureReason: (r.failure_reason as string | null) ?? null,
    };
  });
}

export type StuckSettlementSnapshot = {
  id: string;
  scope: string;
  status: string;
  settlementType: string;
  roomCode: string | null;
  matchInstance: number | null;
  tournamentId: string | null;
  retryCount: number;
  ageMs: number;
  failureReason: string | null;
};

export async function listStuckSettlements(
  limit = 50
): Promise<StuckSettlementSnapshot[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("settlement_events")
    .select(
      "id, scope, status, settlement_type, room_code, match_instance, tournament_id, retry_count, created_at, failure_reason"
    )
    .in("status", [
      "processing",
      "failed",
      "requires_payout",
      "manual_review",
      "pending",
    ])
    .order("created_at", { ascending: true })
    .limit(limit);
  const now = Date.now();
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const created = new Date((r.created_at as string) ?? new Date().toISOString());
    return {
      id: r.id as string,
      scope: r.scope as string,
      status: r.status as string,
      settlementType: r.settlement_type as string,
      roomCode: (r.room_code as string | null) ?? null,
      matchInstance: (r.match_instance as number | null) ?? null,
      tournamentId: (r.tournament_id as string | null) ?? null,
      retryCount: Number(r.retry_count ?? 0),
      ageMs: now - created.getTime(),
      failureReason: (r.failure_reason as string | null) ?? null,
    };
  });
}
