/**
 * Phase 10 — Escrow lifecycle (lock / release / refund).
 *
 * Escrow status machine:
 *   pending  → locked  : `lockEscrow()` successfully reserved funds
 *   pending  → failed  : ledger debit failed (insufficient balance, etc.)
 *   locked   → settled : `releaseEscrow()` paid out / consumed the stake
 *   locked   → refunded: `refundEscrow()` returned the stake to the user
 *
 * Idempotency:
 *   - Every escrow row carries a unique `(room_code, match_instance,
 *     user_id)` (match) or `(tournament_id, user_id)` (tournament entry)
 *     index. Duplicate lock attempts collapse onto the existing row.
 *   - Every ledger entry carries a deterministic idempotency key built
 *     in `idempotency.ts`. Re-running the pipeline yields no new rows.
 */

import { supabase } from "../config";
import { ECONOMY_ENABLED, DEFAULT_CURRENCY } from "./config";
import { emitAuditEvent } from "./audit";
import { createLedgerEntry } from "./wallet";
import {
  createMatchEscrowKey,
  createTournamentEntryEscrowKey,
  isUniqueViolation,
} from "./idempotency";

export type EscrowStatus =
  | "pending"
  | "locked"
  | "settled"
  | "refunded"
  | "failed"
  | "manual_review";

export type EscrowScope = "match" | "tournament_entry";

export type EscrowRow = {
  id: string;
  user_id: string;
  scope: EscrowScope;
  room_code: string | null;
  match_instance: number | null;
  tournament_id: string | null;
  amount_minor: number;
  currency: string;
  status: EscrowStatus;
  locked_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
};

/* ---------------------------------------------------------------------------
 * Match escrow
 * --------------------------------------------------------------------------- */

export type LockMatchEscrowInput = {
  userId: string;
  roomCode: string;
  matchInstance: number;
  amountMinor: number;
  currency?: string;
};

export async function lockMatchEscrow(
  input: LockMatchEscrowInput
): Promise<{ ok: true; escrow: EscrowRow } | { ok: false; reason: string }> {
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };
  if (!supabase) return { ok: false, reason: "no_backend" };
  if (input.amountMinor <= 0) return { ok: false, reason: "invalid_amount" };

  const currency = input.currency ?? DEFAULT_CURRENCY;

  // Insert (or reuse) the escrow row in `pending` state.
  const insertResult = await supabase
    .from("escrow_locks")
    .insert({
      user_id: input.userId,
      scope: "match",
      room_code: input.roomCode,
      match_instance: input.matchInstance,
      amount_minor: input.amountMinor,
      currency,
      status: "pending",
    })
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
    )
    .single();

  let escrow = insertResult.data as EscrowRow | null;

  if (insertResult.error) {
    if (!isUniqueViolation(insertResult.error)) {
      console.error(`[Escrow] insert failed:`, insertResult.error);
      return { ok: false, reason: "insert_failed" };
    }
    // Already exists — read it.
    const { data: existing, error: readError } = await supabase
      .from("escrow_locks")
      .select(
        "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
      )
      .eq("scope", "match")
      .eq("room_code", input.roomCode)
      .eq("match_instance", input.matchInstance)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (readError || !existing) {
      return { ok: false, reason: "read_after_conflict_failed" };
    }
    escrow = existing as EscrowRow;
  }

  if (!escrow) return { ok: false, reason: "no_row" };

  // Already past pending → idempotent return.
  if (escrow.status === "locked" || escrow.status === "settled") {
    console.log(
      `[Escrow] lock duplicate collapsed roomCode=${input.roomCode} ` +
        `mi=${input.matchInstance} userId=${input.userId} status=${escrow.status}`
    );
    return { ok: true, escrow };
  }

  if (escrow.status === "refunded" || escrow.status === "failed") {
    return { ok: false, reason: `escrow_terminal_${escrow.status}` };
  }

  // Move funds available → locked via the ledger RPC.
  const ledger = await createLedgerEntry({
    userId: input.userId,
    amountMinor: input.amountMinor,
    direction: "debit",
    pocket: "transfer",
    transactionType: "escrow_lock",
    idempotencyKey: createMatchEscrowKey(
      input.roomCode,
      input.matchInstance,
      "lock",
      input.userId
    ),
    referenceType: "match_escrow",
    referenceId: escrow.id,
    metadata: {
      roomCode: input.roomCode,
      matchInstance: input.matchInstance,
    },
  });

  if (ledger.ok === false) {
    const failReason = ledger.reason;
    await markEscrowFailed(escrow.id, failReason);
    await emitAuditEvent({
      eventType: "escrow.lock_failed",
      severity: "warning",
      actorKind: "realtime_server",
      actorId: input.userId,
      referenceType: "match_escrow",
      referenceId: escrow.id,
      payload: { reason: failReason },
    });
    return { ok: false, reason: failReason };
  }

  const transitioned = await transitionEscrowStatus(escrow.id, "locked", {
    locked_at: new Date().toISOString(),
  });
  if (!transitioned) {
    return { ok: false, reason: "status_transition_failed" };
  }

  await emitAuditEvent({
    eventType: "escrow.locked",
    actorKind: "realtime_server",
    actorId: input.userId,
    referenceType: "match_escrow",
    referenceId: escrow.id,
    payload: {
      roomCode: input.roomCode,
      matchInstance: input.matchInstance,
      amountMinor: input.amountMinor,
    },
  });

  console.log(
    `[Escrow] locked roomCode=${input.roomCode} mi=${input.matchInstance} ` +
      `userId=${input.userId} amount=${input.amountMinor}`
  );

  return { ok: true, escrow: { ...escrow, status: "locked" } };
}

/* ---------------------------------------------------------------------------
 * Settlement-direction releases
 * --------------------------------------------------------------------------- */

export type ReleaseMatchEscrowInput = {
  userId: string;
  roomCode: string;
  matchInstance: number;
  amountMinor: number;
  /**
   * "payout" credits available_balance (winner receives stakes).
   * "consume" simply marks the escrow `settled` without crediting back
   *   (loser stake goes to the prize pool — caller manages where).
   */
  mode: "payout" | "consume";
};

export async function releaseMatchEscrow(
  input: ReleaseMatchEscrowInput
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };
  if (!supabase) return { ok: false, reason: "no_backend" };

  const { data, error } = await supabase
    .from("escrow_locks")
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
    )
    .eq("scope", "match")
    .eq("room_code", input.roomCode)
    .eq("match_instance", input.matchInstance)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "escrow_not_found" };
  const escrow = data as EscrowRow;

  if (escrow.status === "settled") {
    console.log(
      `[Escrow] release duplicate collapsed escrowId=${escrow.id}`
    );
    return { ok: true };
  }

  if (escrow.status !== "locked") {
    return { ok: false, reason: `escrow_not_locked_${escrow.status}` };
  }

  if (input.mode === "payout") {
    const ledger = await createLedgerEntry({
      userId: input.userId,
      amountMinor: input.amountMinor,
      direction: "credit",
      pocket: "transfer", // locked → available
      transactionType: "escrow_payout",
      idempotencyKey: createMatchEscrowKey(
        input.roomCode,
        input.matchInstance,
        "payout",
        input.userId
      ),
      referenceType: "match_escrow",
      referenceId: escrow.id,
      metadata: {
        roomCode: input.roomCode,
        matchInstance: input.matchInstance,
      },
    });
    if (ledger.ok === false) return { ok: false, reason: ledger.reason };
  } else {
    // consume: locked → 0 (no credit to user). Ledger as escrow_release
    // debiting locked pocket.
    const ledger = await createLedgerEntry({
      userId: input.userId,
      amountMinor: input.amountMinor,
      direction: "debit",
      pocket: "locked",
      transactionType: "escrow_release",
      idempotencyKey: createMatchEscrowKey(
        input.roomCode,
        input.matchInstance,
        "release",
        input.userId
      ),
      referenceType: "match_escrow",
      referenceId: escrow.id,
      metadata: {
        roomCode: input.roomCode,
        matchInstance: input.matchInstance,
        mode: "consume",
      },
    });
    if (ledger.ok === false) return { ok: false, reason: ledger.reason };
  }

  await transitionEscrowStatus(escrow.id, "settled", {
    released_at: new Date().toISOString(),
  });

  await emitAuditEvent({
    eventType: "escrow.released",
    actorKind: "realtime_server",
    actorId: input.userId,
    referenceType: "match_escrow",
    referenceId: escrow.id,
    payload: { mode: input.mode, amountMinor: input.amountMinor },
  });

  console.log(
    `[Escrow] released escrowId=${escrow.id} mode=${input.mode} userId=${input.userId}`
  );

  return { ok: true };
}

export type RefundMatchEscrowInput = {
  userId: string;
  roomCode: string;
  matchInstance: number;
  amountMinor: number;
};

export async function refundMatchEscrow(
  input: RefundMatchEscrowInput
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };
  if (!supabase) return { ok: false, reason: "no_backend" };

  const { data, error } = await supabase
    .from("escrow_locks")
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status"
    )
    .eq("scope", "match")
    .eq("room_code", input.roomCode)
    .eq("match_instance", input.matchInstance)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "escrow_not_found" };
  const escrow = data as EscrowRow;

  if (escrow.status === "refunded") {
    console.log(`[Escrow] refund duplicate collapsed escrowId=${escrow.id}`);
    return { ok: true };
  }
  if (escrow.status !== "locked") {
    return { ok: false, reason: `escrow_not_locked_${escrow.status}` };
  }

  const ledger = await createLedgerEntry({
    userId: input.userId,
    amountMinor: input.amountMinor,
    direction: "credit",
    pocket: "transfer", // locked → available
    transactionType: "escrow_refund",
    idempotencyKey: createMatchEscrowKey(
      input.roomCode,
      input.matchInstance,
      "refund",
      input.userId
    ),
    referenceType: "match_escrow",
    referenceId: escrow.id,
    metadata: {
      roomCode: input.roomCode,
      matchInstance: input.matchInstance,
    },
  });
  if (ledger.ok === false) return { ok: false, reason: ledger.reason };

  await transitionEscrowStatus(escrow.id, "refunded", {
    refunded_at: new Date().toISOString(),
  });

  await emitAuditEvent({
    eventType: "escrow.refunded",
    actorKind: "realtime_server",
    actorId: input.userId,
    referenceType: "match_escrow",
    referenceId: escrow.id,
    payload: { amountMinor: input.amountMinor },
  });

  console.log(
    `[Escrow] refunded escrowId=${escrow.id} userId=${input.userId}`
  );

  return { ok: true };
}

/* ---------------------------------------------------------------------------
 * Tournament entry escrow (foundation)
 * --------------------------------------------------------------------------- */

export type LockTournamentEntryEscrowInput = {
  userId: string;
  tournamentId: string;
  amountMinor: number;
  currency?: string;
};

export async function lockTournamentEntryEscrow(
  input: LockTournamentEntryEscrowInput
): Promise<{ ok: true; escrow: EscrowRow } | { ok: false; reason: string }> {
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };
  if (!supabase) return { ok: false, reason: "no_backend" };
  if (input.amountMinor <= 0) return { ok: false, reason: "invalid_amount" };

  const currency = input.currency ?? DEFAULT_CURRENCY;

  const insertResult = await supabase
    .from("escrow_locks")
    .insert({
      user_id: input.userId,
      scope: "tournament_entry",
      tournament_id: input.tournamentId,
      amount_minor: input.amountMinor,
      currency,
      status: "pending",
    })
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
    )
    .single();

  let escrow = insertResult.data as EscrowRow | null;

  if (insertResult.error) {
    if (!isUniqueViolation(insertResult.error)) {
      return { ok: false, reason: "insert_failed" };
    }
    const { data: existing } = await supabase
      .from("escrow_locks")
      .select(
        "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
      )
      .eq("scope", "tournament_entry")
      .eq("tournament_id", input.tournamentId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (!existing) return { ok: false, reason: "read_after_conflict_failed" };
    escrow = existing as EscrowRow;
  }

  if (!escrow) return { ok: false, reason: "no_row" };

  if (escrow.status === "locked" || escrow.status === "settled") {
    return { ok: true, escrow };
  }
  if (escrow.status === "refunded" || escrow.status === "failed") {
    return { ok: false, reason: `escrow_terminal_${escrow.status}` };
  }

  const ledger = await createLedgerEntry({
    userId: input.userId,
    amountMinor: input.amountMinor,
    direction: "debit",
    pocket: "transfer",
    transactionType: "tournament_entry_fee",
    idempotencyKey: createTournamentEntryEscrowKey(
      input.tournamentId,
      "lock",
      input.userId
    ),
    referenceType: "tournament_escrow",
    referenceId: escrow.id,
    metadata: { tournamentId: input.tournamentId },
  });

  if (ledger.ok === false) {
    const failReason = ledger.reason;
    await markEscrowFailed(escrow.id, failReason);
    return { ok: false, reason: failReason };
  }

  await transitionEscrowStatus(escrow.id, "locked", {
    locked_at: new Date().toISOString(),
  });

  await emitAuditEvent({
    eventType: "escrow.tournament_entry_locked",
    actorKind: "realtime_server",
    actorId: input.userId,
    referenceType: "tournament_escrow",
    referenceId: escrow.id,
    payload: {
      tournamentId: input.tournamentId,
      amountMinor: input.amountMinor,
    },
  });

  return { ok: true, escrow: { ...escrow, status: "locked" } };
}

/* ---------------------------------------------------------------------------
 * Internal helpers
 * --------------------------------------------------------------------------- */

async function transitionEscrowStatus(
  escrowId: string,
  next: EscrowStatus,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("escrow_locks")
    .update({ status: next, ...extra })
    .eq("id", escrowId);
  if (error) {
    console.error(
      `[Escrow] status transition failed escrowId=${escrowId} → ${next}:`,
      error
    );
    return false;
  }
  return true;
}

async function markEscrowFailed(
  escrowId: string,
  reason: string
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("escrow_locks")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", escrowId);
}

/**
 * Phase 12: park an escrow in `manual_review` when the reconciliation
 * worker cannot decide what to do safely (e.g. locked escrow older than
 * the long timeout but room still in memory). No funds move.
 */
export async function markEscrowManualReview(
  escrowId: string,
  reason: string
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("escrow_locks")
    .update({ status: "manual_review", failure_reason: reason })
    .eq("id", escrowId);
  await emitAuditEvent({
    eventType: "escrow.manual_review_required",
    severity: "critical",
    actorKind: "realtime_server",
    referenceType: "escrow",
    referenceId: escrowId,
    payload: { reason },
  });
  console.error(
    `[EconomyRecovery] escrow flagged for manual review escrowId=${escrowId} reason=${reason}`
  );
}

export async function fetchMatchEscrowsForRoom(
  roomCode: string,
  matchInstance: number
): Promise<EscrowRow[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("escrow_locks")
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
    )
    .eq("scope", "match")
    .eq("room_code", roomCode)
    .eq("match_instance", matchInstance);
  return (data ?? []) as EscrowRow[];
}

/**
 * Phase 12 TASK 5 helper: refund a tournament-entry escrow given the
 * full row. Idempotent — duplicate calls collapse onto the same ledger
 * row via the deterministic idempotency key. Returns `{ ok: true }`
 * when the escrow is already refunded.
 */
export async function refundTournamentEntryEscrowByRow(
  row: EscrowRow
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };
  if (!supabase) return { ok: false, reason: "no_backend" };
  if (row.scope !== "tournament_entry") {
    return { ok: false, reason: "wrong_scope" };
  }
  if (!row.tournament_id) {
    return { ok: false, reason: "missing_tournament_id" };
  }
  if (row.status === "refunded") return { ok: true };
  if (row.status !== "locked") {
    return { ok: false, reason: `escrow_not_locked_${row.status}` };
  }

  const ledger = await createLedgerEntry({
    userId: row.user_id,
    amountMinor: row.amount_minor,
    direction: "credit",
    pocket: "transfer",
    transactionType: "tournament_entry_refund",
    idempotencyKey: createTournamentEntryEscrowKey(
      row.tournament_id,
      "refund",
      row.user_id
    ),
    referenceType: "tournament_escrow",
    referenceId: row.id,
    metadata: {
      tournamentId: row.tournament_id,
      reconciliation: true,
    },
  });

  if (ledger.ok === false) {
    return { ok: false, reason: ledger.reason };
  }

  await transitionEscrowStatus(row.id, "refunded", {
    refunded_at: new Date().toISOString(),
  });

  await emitAuditEvent({
    eventType: "escrow.tournament_entry_refunded",
    actorKind: "realtime_server",
    actorId: row.user_id,
    referenceType: "tournament_escrow",
    referenceId: row.id,
    payload: {
      tournamentId: row.tournament_id,
      amountMinor: row.amount_minor,
      via: "fanout",
    },
  });

  console.log(
    `[Refund] tournament entry refunded (fanout) escrowId=${row.id} userId=${row.user_id}`
  );

  return { ok: true };
}
