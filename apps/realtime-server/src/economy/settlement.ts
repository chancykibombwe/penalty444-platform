/**
 * Phase 10 — Match & tournament settlement pipeline.
 *
 * `settleMatchEconomy` and `settleTournamentEconomy` are the entry
 * points called AFTER an authoritative result has been persisted
 * (`match_results` row or `tournaments.winner_id`). The pipeline:
 *
 *   1. Verify the authoritative result exists.
 *   2. Verify a `settlement_events` row does not already exist
 *      (`UNIQUE(room_code, match_instance, settlement_type)` /
 *      `UNIQUE(tournament_id, settlement_type)`).
 *   3. Insert a `settlement_events` row in `processing` state. If the
 *      insert raises `23505` we treat this as "already processed" and
 *      short-circuit (mirrors Sprint 1's `saveMatchResult` pattern).
 *   4. Fetch the locked escrow rows.
 *   5. For each player: release / refund / payout via the escrow service.
 *   6. Flip `settlement_events.status = 'completed'`.
 *   7. Emit `[Settlement]` log + audit event.
 *
 * On any error step 6 stays `processing`. A reconciliation cron (future
 * sprint) sweeps stuck rows.
 *
 * NOT CALLED FROM gameplay yet — this lives behind the `ECONOMY_ENABLED`
 * flag and waits for the integration in a later sprint.
 */

import { supabase } from "../config";
import { ECONOMY_ENABLED } from "./config";
import { emitAuditEvent } from "./audit";
import {
  assertMatchSettlementNotProcessed,
  createSettlementKey,
  isUniqueViolation,
  type SettlementType,
} from "./idempotency";
import {
  fetchMatchEscrowsForRoom,
  refundMatchEscrow,
  releaseMatchEscrow,
} from "./escrow";

/* ---------------------------------------------------------------------------
 * Match settlement
 * --------------------------------------------------------------------------- */

export type SettleMatchInput = {
  roomCode: string;
  matchInstance: number;
};

export type SettleMatchResult =
  | { ok: true; type: SettlementType; alreadyProcessed: boolean }
  | { ok: false; reason: string };

export async function settleMatchEconomy(
  input: SettleMatchInput
): Promise<SettleMatchResult> {
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };
  if (!supabase) return { ok: false, reason: "no_backend" };

  // 1. Verify authoritative match_result row exists.
  const { data: matchRow, error: matchError } = await supabase
    .from("match_results")
    .select(
      "room_code, match_instance, player_one_id, player_two_id, winner_id, is_draw"
    )
    .eq("room_code", input.roomCode)
    .eq("match_instance", input.matchInstance)
    .maybeSingle();

  if (matchError) {
    console.error(`[Settlement] match_results lookup failed:`, matchError);
    return { ok: false, reason: "result_lookup_failed" };
  }
  if (!matchRow) return { ok: false, reason: "result_missing" };

  const isDraw = !!matchRow.is_draw;
  const settlementType: SettlementType = isDraw
    ? "match_draw_refund"
    : "match_payout";

  // 2. Soft pre-flight: settlement already exists?
  const preflight = await assertMatchSettlementNotProcessed(
    input.roomCode,
    input.matchInstance,
    settlementType
  );
  if (preflight.processed && preflight.status === "completed") {
    console.log(
      `[Settlement] match already settled roomCode=${input.roomCode} ` +
        `mi=${input.matchInstance} type=${settlementType}`
    );
    return { ok: true, type: settlementType, alreadyProcessed: true };
  }

  // 3. Insert settlement event in processing state.
  const settlementKey = createSettlementKey(
    "match",
    { roomCode: input.roomCode, matchInstance: input.matchInstance },
    settlementType
  );

  const { data: settlement, error: settlementError } = await supabase
    .from("settlement_events")
    .insert({
      scope: "match",
      room_code: input.roomCode,
      match_instance: input.matchInstance,
      settlement_type: settlementType,
      status: "processing",
      idempotency_key: settlementKey,
    })
    .select("id, status")
    .single();

  if (settlementError) {
    if (isUniqueViolation(settlementError)) {
      console.log(
        `[Settlement] duplicate settlement event collapsed roomCode=${input.roomCode} ` +
          `mi=${input.matchInstance} type=${settlementType}`
      );
      return { ok: true, type: settlementType, alreadyProcessed: true };
    }
    console.error(
      `[Settlement] settlement_events insert failed:`,
      settlementError
    );
    return { ok: false, reason: "settlement_insert_failed" };
  }

  const settlementId = (settlement as { id: string }).id;

  // 4. Fetch escrows for the match (any status) so we can validate.
  const allEscrows = await fetchMatchEscrowsForRoom(
    input.roomCode,
    input.matchInstance
  );

  // Phase 12 TASK 6: only LOCKED escrows contribute to the pot. Refunded,
  // settled, failed, manual_review rows are deliberately ignored — they
  // either left funds with the player or never debited at all.
  const lockedEscrows = allEscrows.filter((e) => e.status === "locked");

  // Phase 12 TASK 6: pot integrity guard. For Phase 11 matches we expect
  // exactly two locked escrows (host + guest). Anything else means the
  // bookkeeping is wrong; we MUST NOT pay out. Flag the settlement for
  // manual review and bail.
  const EXPECTED_LOCKED = 2;
  if (lockedEscrows.length !== EXPECTED_LOCKED) {
    await emitAuditEvent({
      eventType: "settlement.invalid_pot_state",
      severity: "critical",
      actorKind: "realtime_server",
      referenceType: "settlement",
      referenceId: settlementId,
      payload: {
        roomCode: input.roomCode,
        matchInstance: input.matchInstance,
        lockedCount: lockedEscrows.length,
        totalEscrows: allEscrows.length,
        statuses: allEscrows.map((e) => e.status),
      },
    });
    return await markSettlementManualReview(
      settlementId,
      `invalid_locked_count:${lockedEscrows.length}`
    );
  }

  const pot = lockedEscrows.reduce((sum, e) => sum + e.amount_minor, 0);

  // 5. Apply per-player escrow transitions (locked rows only).
  for (const escrow of lockedEscrows) {
    if (isDraw) {
      const refund = await refundMatchEscrow({
        userId: escrow.user_id,
        roomCode: input.roomCode,
        matchInstance: input.matchInstance,
        amountMinor: escrow.amount_minor,
      });
      if (refund.ok === false) {
        return await markSettlementFailed(
          settlementId,
          `refund_failed:${refund.reason}`
        );
      }
    } else {
      const isWinner = matchRow.winner_id === escrow.user_id;
      if (isWinner) {
        // Winner gets the full pot (their own stake + the loser's).
        const payout = await releaseMatchEscrow({
          userId: escrow.user_id,
          roomCode: input.roomCode,
          matchInstance: input.matchInstance,
          amountMinor: pot,
          mode: "payout",
        });
        if (payout.ok === false) {
          return await markSettlementFailed(
            settlementId,
            `payout_failed:${payout.reason}`
          );
        }
      } else {
        // Loser's stake is consumed (already debited to locked at lock time).
        const consume = await releaseMatchEscrow({
          userId: escrow.user_id,
          roomCode: input.roomCode,
          matchInstance: input.matchInstance,
          amountMinor: escrow.amount_minor,
          mode: "consume",
        });
        if (consume.ok === false) {
          return await markSettlementFailed(
            settlementId,
            `consume_failed:${consume.reason}`
          );
        }
      }
    }
  }

  // 6. Mark settlement completed.
  const { error: completeError } = await supabase
    .from("settlement_events")
    .update({ status: "completed", processed_at: new Date().toISOString() })
    .eq("id", settlementId);
  if (completeError) {
    console.error(
      `[Settlement] failed to mark completed settlementId=${settlementId}:`,
      completeError
    );
    return { ok: false, reason: "complete_update_failed" };
  }

  await emitAuditEvent({
    eventType: "settlement.match_completed",
    actorKind: "realtime_server",
    referenceType: "settlement",
    referenceId: settlementId,
    payload: {
      roomCode: input.roomCode,
      matchInstance: input.matchInstance,
      settlementType,
      winnerId: matchRow.winner_id ?? null,
      isDraw,
      escrowCount: lockedEscrows.length,
      potMinor: pot,
    },
  });

  console.log(
    `[Settlement] match completed roomCode=${input.roomCode} ` +
      `mi=${input.matchInstance} type=${settlementType} ` +
      `winnerId=${matchRow.winner_id ?? "—"} escrows=${lockedEscrows.length} ` +
      `pot=${pot}`
  );

  return { ok: true, type: settlementType, alreadyProcessed: false };
}

/* ---------------------------------------------------------------------------
 * Tournament settlement (foundation)
 * --------------------------------------------------------------------------- */

export type SettleTournamentInput = {
  tournamentId: string;
};

export type SettleTournamentResult =
  | { ok: true; alreadyProcessed: boolean }
  | { ok: false; reason: string };

/**
 * Phase 12 hardening: this function MUST NOT pretend success when a real
 * prize pool exists. Behaviour matrix:
 *
 *   prize_pool_minor = 0
 *     → foundation no-op. Insert settlement_events status=completed,
 *       audit `tournament_foundation_no_payout`, return ok.
 *
 *   prize_pool_minor > 0
 *     → Insert settlement_events status=requires_payout, audit
 *       `tournament_requires_payout`, return ok=false with reason
 *       "payout_not_implemented". The reconciliation worker WILL NOT
 *       attempt to auto-pay; an operator (or Phase 13 payout module)
 *       must flip the row to completed once prize distribution lands.
 *
 * This is the "must NOT fake-complete" guard from Phase 12 TASK 4.
 */
export async function settleTournamentEconomy(
  input: SettleTournamentInput
): Promise<SettleTournamentResult> {
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };
  if (!supabase) return { ok: false, reason: "no_backend" };

  const { data: tournament, error: lookupError } = await supabase
    .from("tournaments")
    .select(
      "id, status, winner_id, entry_fee_minor, prize_pool_minor, payout_structure, rake_bps"
    )
    .eq("id", input.tournamentId)
    .maybeSingle();

  if (lookupError || !tournament) {
    return { ok: false, reason: "tournament_not_found" };
  }
  if (tournament.status !== "completed") {
    return { ok: false, reason: `tournament_status_${tournament.status}` };
  }

  const prizePoolMinor = Number(tournament.prize_pool_minor ?? 0);
  const settlementType: SettlementType = "tournament_payout";
  const settlementKey = createSettlementKey(
    "tournament",
    { tournamentId: input.tournamentId },
    settlementType
  );

  // Pre-flight: settlement already exists?
  const { data: existingSettlement } = await supabase
    .from("settlement_events")
    .select("id, status")
    .eq("idempotency_key", settlementKey)
    .maybeSingle();

  if (existingSettlement) {
    if (existingSettlement.status === "completed") {
      return { ok: true, alreadyProcessed: true };
    }
    if (existingSettlement.status === "requires_payout") {
      // Already flagged — caller knows; idempotent reply.
      return { ok: false, reason: "payout_not_implemented" };
    }
    // For any other status (processing/failed/manual_review) we leave
    // the reconciliation worker to handle.
  }

  if (prizePoolMinor > 0) {
    // Hard guard: insert as requires_payout. Do not mark completed.
    const { error: insertError } = await supabase
      .from("settlement_events")
      .insert({
        scope: "tournament",
        tournament_id: input.tournamentId,
        settlement_type: settlementType,
        status: "requires_payout",
        idempotency_key: settlementKey,
        notes: "phase12_payout_not_implemented",
      });
    if (insertError && !isUniqueViolation(insertError)) {
      return { ok: false, reason: "settlement_insert_failed" };
    }

    await emitAuditEvent({
      eventType: "settlement.tournament_requires_payout",
      severity: "warning",
      actorKind: "realtime_server",
      referenceType: "settlement",
      referenceId: settlementKey,
      payload: {
        tournamentId: input.tournamentId,
        winnerId: tournament.winner_id ?? null,
        prizePoolMinor,
        entryFeeMinor: tournament.entry_fee_minor ?? 0,
      },
    });

    console.warn(
      `[Settlement] tournament requires payout tournamentId=${input.tournamentId} ` +
        `prizePool=${prizePoolMinor} — refusing to fake-complete`
    );
    return { ok: false, reason: "payout_not_implemented" };
  }

  // Zero-prize-pool path (e.g. free tournament that still completes).
  // Foundation only: there is literally nothing to distribute.
  const { error: settlementError } = await supabase
    .from("settlement_events")
    .insert({
      scope: "tournament",
      tournament_id: input.tournamentId,
      settlement_type: settlementType,
      status: "processing",
      idempotency_key: settlementKey,
      notes: "phase12_foundation_no_payout_zero_pool",
    });

  if (settlementError) {
    if (isUniqueViolation(settlementError)) {
      return { ok: true, alreadyProcessed: true };
    }
    return { ok: false, reason: "settlement_insert_failed" };
  }

  await supabase
    .from("settlement_events")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
    })
    .eq("idempotency_key", settlementKey);

  await emitAuditEvent({
    eventType: "settlement.tournament_foundation_no_payout",
    actorKind: "realtime_server",
    referenceType: "settlement",
    referenceId: settlementKey,
    payload: {
      tournamentId: input.tournamentId,
      winnerId: tournament.winner_id ?? null,
      entryFeeMinor: tournament.entry_fee_minor ?? 0,
      prizePoolMinor,
    },
  });

  console.log(
    `[Settlement] tournament foundation completed (zero pool) tournamentId=${input.tournamentId} ` +
      `winnerId=${tournament.winner_id ?? "—"}`
  );

  return { ok: true, alreadyProcessed: false };
}

/* ---------------------------------------------------------------------------
 * Internal helpers
 * --------------------------------------------------------------------------- */

async function markSettlementFailed(
  settlementId: string,
  reason: string
): Promise<SettleMatchResult> {
  if (supabase) {
    await supabase
      .from("settlement_events")
      .update({
        status: "failed",
        failure_reason: reason,
        notes: reason,
      })
      .eq("id", settlementId);
  }
  await emitAuditEvent({
    eventType: "settlement.failed",
    severity: "error",
    actorKind: "realtime_server",
    referenceType: "settlement",
    referenceId: settlementId,
    payload: { reason },
  });
  console.error(
    `[Settlement] failed settlementId=${settlementId} reason=${reason}`
  );
  return { ok: false, reason };
}

/**
 * Phase 12: when the worker cannot decide what to do, the settlement
 * lands here. Operators inspect via /internal/economy/ops/settlements/stuck
 * and reset the row manually.
 */
async function markSettlementManualReview(
  settlementId: string,
  reason: string
): Promise<SettleMatchResult> {
  if (supabase) {
    await supabase
      .from("settlement_events")
      .update({
        status: "manual_review",
        failure_reason: reason,
        notes: reason,
      })
      .eq("id", settlementId);
  }
  await emitAuditEvent({
    eventType: "settlement.manual_review_required",
    severity: "critical",
    actorKind: "realtime_server",
    referenceType: "settlement",
    referenceId: settlementId,
    payload: { reason },
  });
  console.error(
    `[Settlement] manual review required settlementId=${settlementId} reason=${reason}`
  );
  return { ok: false, reason };
}
