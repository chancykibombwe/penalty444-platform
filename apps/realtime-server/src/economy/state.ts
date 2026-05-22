/**
 * Phase 12 — Escrow & settlement state validation helpers.
 *
 * Centralised so the reconciliation worker and the integration layer use
 * the same rules instead of redefining transition tables in three places.
 *
 * Hard rules (mirrors `docs/escrow-lifecycle.md`):
 *
 *   pending  → locked        (lock succeeded)
 *   pending  → failed        (ledger debit failed)
 *   pending  → manual_review (lock stuck > timeout, ops decision needed)
 *   locked   → settled       (released via payout or consume)
 *   locked   → refunded      (returned to user via refundEscrow)
 *   locked   → manual_review (reconciliation cannot decide safely)
 *
 * Terminal states (no exit):
 *   settled, refunded, failed
 *
 * `manual_review` is intentionally NOT terminal so an operator can move
 * the row back to `refunded`/`settled` after investigation. The
 * reconciliation worker never auto-recovers a `manual_review` row.
 */

import type { EscrowStatus } from "./escrow";

export type SettlementStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "reversed"
  | "requires_payout"
  | "manual_review";

/* ---------------------------------------------------------------------------
 * Escrow
 * --------------------------------------------------------------------------- */

const ESCROW_TRANSITIONS: Record<EscrowStatus, EscrowStatus[]> = {
  pending: ["locked", "failed", "manual_review"],
  locked: ["settled", "refunded", "manual_review"],
  settled: [],
  refunded: [],
  failed: [],
  manual_review: ["refunded", "settled"], // ops-only manual fix path
};

const TERMINAL_ESCROW_STATUSES: ReadonlySet<EscrowStatus> = new Set([
  "settled",
  "refunded",
  "failed",
]);

const RECOVERABLE_ESCROW_STATUSES: ReadonlySet<EscrowStatus> = new Set([
  "pending",
  "locked",
]);

export type EscrowTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateEscrowStateTransition(
  from: EscrowStatus,
  to: EscrowStatus
): EscrowTransitionResult {
  if (from === to) {
    return { ok: false, reason: "no_op_transition" };
  }
  const allowed = ESCROW_TRANSITIONS[from];
  if (!allowed) {
    return { ok: false, reason: `unknown_from_status_${from}` };
  }
  if (!allowed.includes(to)) {
    return { ok: false, reason: `invalid_transition_${from}_to_${to}` };
  }
  return { ok: true };
}

export function isTerminalEscrowStatus(status: EscrowStatus): boolean {
  return TERMINAL_ESCROW_STATUSES.has(status);
}

export function isRecoverableEscrowStatus(status: EscrowStatus): boolean {
  return RECOVERABLE_ESCROW_STATUSES.has(status);
}

/* ---------------------------------------------------------------------------
 * Settlement
 * --------------------------------------------------------------------------- */

const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  pending: ["processing", "manual_review"],
  processing: [
    "completed",
    "failed",
    "requires_payout",
    "manual_review",
  ],
  completed: [],
  reversed: [],
  // `failed` is not terminal in Phase 12 — the worker can retry it back
  // into `processing`. After MAX_SETTLEMENT_RETRIES the worker stops
  // touching it and flags `manual_review`.
  failed: ["processing", "manual_review"],
  requires_payout: ["completed", "manual_review"],
  manual_review: ["processing", "completed", "reversed"],
};

const TERMINAL_SETTLEMENT_STATUSES: ReadonlySet<SettlementStatus> = new Set([
  "completed",
  "reversed",
]);

export function validateSettlementStateTransition(
  from: SettlementStatus,
  to: SettlementStatus
): EscrowTransitionResult {
  if (from === to) return { ok: false, reason: "no_op_transition" };
  const allowed = SETTLEMENT_TRANSITIONS[from];
  if (!allowed) {
    return { ok: false, reason: `unknown_from_status_${from}` };
  }
  if (!allowed.includes(to)) {
    return { ok: false, reason: `invalid_transition_${from}_to_${to}` };
  }
  return { ok: true };
}

export function isTerminalSettlementStatus(status: SettlementStatus): boolean {
  return TERMINAL_SETTLEMENT_STATUSES.has(status);
}

/**
 * `true` for statuses the reconciliation worker is allowed to TOUCH.
 * `manual_review` is excluded — those need a human.
 */
export function isReconcilableSettlementStatus(
  status: SettlementStatus
): boolean {
  return (
    status === "processing" ||
    status === "failed" ||
    status === "pending" ||
    status === "requires_payout"
  );
}
