/**
 * Phase 11 — Economy integration layer.
 *
 * Thin no-op-safe wrappers used at the match / tournament lifecycle
 * call sites. Each wrapper:
 *
 *   1. Returns early (`skipped=true`) when ECONOMY_ENABLED is false.
 *   2. Returns early when the stake / fee is zero (free play).
 *   3. Returns early when supabase is not configured.
 *   4. Otherwise calls into the Phase 10 escrow / settlement helpers
 *      with the right idempotency keys.
 *
 * The legacy `wallet/stakes.ts` path is untouched. Both run in parallel
 * when ECONOMY_ENABLED is on; they use different tables and never
 * cross-contaminate. When ECONOMY_ENABLED is off (the default in every
 * environment for Phase 11), the entire economy code path is dead and
 * gameplay behaves exactly as before.
 */

import { supabase } from "../config";
import type { Room } from "../types/room";
import { ECONOMY_ENABLED, MINOR_UNITS_PER_UNIT } from "./config";
import {
  lockMatchEscrow,
  lockTournamentEntryEscrow,
  refundMatchEscrow,
  refundTournamentEntryEscrowByRow,
  type EscrowRow,
} from "./escrow";
import {
  settleMatchEconomy,
  settleTournamentEconomy,
} from "./settlement";
import { createLedgerEntry } from "./wallet";
import { emitAuditEvent } from "./audit";

const ECONOMY_TEST_MODE = process.env.ECONOMY_TEST_MODE === "true";

/**
 * Phase 11 declares real-money explicitly off. We check this in places
 * that could in the future call into a real payment gateway; in Phase 11
 * the only effect is to keep the test-mode helpers from being mistaken
 * for a production path.
 */
const ECONOMY_REAL_MONEY_ENABLED =
  process.env.ECONOMY_REAL_MONEY_ENABLED === "true";

export type EconomyMode = "off" | "test" | "live";

export function getEconomyMode(): EconomyMode {
  if (!ECONOMY_ENABLED) return "off";
  if (ECONOMY_REAL_MONEY_ENABLED) return "live";
  if (ECONOMY_TEST_MODE) return "test";
  // Enabled but not configured — treat as off for safety.
  return "off";
}

export type EconomyResult =
  | { ok: true; skipped?: boolean; reason?: string }
  | { ok: false; reason: string };

/* ---------------------------------------------------------------------------
 * Match lifecycle wrappers
 * --------------------------------------------------------------------------- */

/**
 * Lock escrow for a single player joining a staked room.
 *
 * Called once per player at the moment they commit to the room
 * (host create, guest join). Free matches are a no-op.
 *
 * Stake conversion: legacy `room.stakeAmount` is in MAJOR units
 * (e.g. 10 = K10). The economy ledger works in MINOR units (×100).
 */
export async function lockMatchEscrowForPlayer(
  room: Room,
  userId: string
): Promise<EconomyResult> {
  if (getEconomyMode() === "off") {
    return { ok: true, skipped: true, reason: "economy_off" };
  }
  if (room.stakeAmount <= 0) {
    return { ok: true, skipped: true, reason: "free_match" };
  }
  if (!supabase) return { ok: true, skipped: true, reason: "no_backend" };

  const amountMinor = room.stakeAmount * MINOR_UNITS_PER_UNIT;

  const result = await lockMatchEscrow({
    userId,
    roomCode: room.code,
    matchInstance: room.matchInstance,
    amountMinor,
  });

  if (result.ok === false) {
    console.warn(
      `[Economy] match escrow lock failed userId=${userId} roomCode=${room.code} ` +
        `mi=${room.matchInstance} reason=${result.reason}`
    );
    return { ok: false, reason: result.reason };
  }
  return { ok: true };
}

/**
 * Refund a single locked match escrow. Idempotent — calling on an
 * already-refunded row is a benign no-op.
 */
export async function refundMatchEscrowForPlayer(
  room: Room,
  userId: string
): Promise<EconomyResult> {
  if (getEconomyMode() === "off") {
    return { ok: true, skipped: true, reason: "economy_off" };
  }
  if (room.stakeAmount <= 0) {
    return { ok: true, skipped: true, reason: "free_match" };
  }
  if (!supabase) return { ok: true, skipped: true, reason: "no_backend" };

  const amountMinor = room.stakeAmount * MINOR_UNITS_PER_UNIT;
  const result = await refundMatchEscrow({
    userId,
    roomCode: room.code,
    matchInstance: room.matchInstance,
    amountMinor,
  });

  if (result.ok === false) {
    if (result.reason === "escrow_not_found") {
      // Player never locked (e.g. legacy path only) — benign.
      return { ok: true, skipped: true, reason: "no_escrow" };
    }
    console.warn(
      `[Refund] match escrow refund failed userId=${userId} roomCode=${room.code} ` +
        `mi=${room.matchInstance} reason=${result.reason}`
    );
    return { ok: false, reason: result.reason };
  }
  console.log(
    `[Refund] match escrow refunded userId=${userId} roomCode=${room.code} mi=${room.matchInstance}`
  );
  return { ok: true };
}

/**
 * Refund every locked escrow for a match. Used by `abortMatchEarly`.
 */
export async function refundAllMatchEscrows(
  room: Room
): Promise<EconomyResult> {
  if (getEconomyMode() === "off") {
    return { ok: true, skipped: true, reason: "economy_off" };
  }
  if (room.stakeAmount <= 0) {
    return { ok: true, skipped: true, reason: "free_match" };
  }
  if (room.players.length === 0) {
    return { ok: true, skipped: true, reason: "no_players" };
  }

  let anyFailed = false;
  for (const player of room.players) {
    const r = await refundMatchEscrowForPlayer(room, player.playerId);
    if (r.ok === false) anyFailed = true;
  }
  if (anyFailed) return { ok: false, reason: "partial_refund_failure" };
  return { ok: true };
}

/**
 * Run the economy settlement pipeline. Always called AFTER
 * `saveMatchResult` has succeeded. No-op when economy is off, stake
 * is zero, or supabase isn't configured.
 */
export async function settleMatchEconomyForRoom(
  room: Room
): Promise<EconomyResult> {
  if (getEconomyMode() === "off") {
    return { ok: true, skipped: true, reason: "economy_off" };
  }
  if (room.stakeAmount <= 0) {
    return { ok: true, skipped: true, reason: "free_match" };
  }
  if (!supabase) return { ok: true, skipped: true, reason: "no_backend" };

  const result = await settleMatchEconomy({
    roomCode: room.code,
    matchInstance: room.matchInstance,
  });

  if (result.ok === false) {
    console.warn(
      `[Settlement] economy settle failed roomCode=${room.code} ` +
        `mi=${room.matchInstance} reason=${result.reason}`
    );
    return { ok: false, reason: result.reason };
  }
  if (result.alreadyProcessed) {
    console.log(
      `[Settlement] economy settle duplicate skipped roomCode=${room.code} mi=${room.matchInstance}`
    );
  }
  return { ok: true };
}

/* ---------------------------------------------------------------------------
 * Tournament lifecycle wrappers
 * --------------------------------------------------------------------------- */

export type LockTournamentEntryInput = {
  userId: string;
  tournamentId: string;
  entryFeeMinor: number;
};

export async function lockTournamentEntryForPlayer(
  input: LockTournamentEntryInput
): Promise<EconomyResult> {
  if (getEconomyMode() === "off") {
    return { ok: true, skipped: true, reason: "economy_off" };
  }
  if (input.entryFeeMinor <= 0) {
    return { ok: true, skipped: true, reason: "free_tournament" };
  }
  if (!supabase) return { ok: true, skipped: true, reason: "no_backend" };

  const result = await lockTournamentEntryEscrow({
    userId: input.userId,
    tournamentId: input.tournamentId,
    amountMinor: input.entryFeeMinor,
  });
  if (result.ok === false) {
    console.warn(
      `[Economy] tournament entry escrow lock failed userId=${input.userId} ` +
        `tournamentId=${input.tournamentId} reason=${result.reason}`
    );
    return { ok: false, reason: result.reason };
  }
  return { ok: true };
}

/**
 * Refund a tournament-entry escrow when a player withdraws before
 * the tournament starts.
 */
export async function refundTournamentEntryForPlayer(input: {
  userId: string;
  tournamentId: string;
}): Promise<EconomyResult> {
  if (getEconomyMode() === "off") {
    return { ok: true, skipped: true, reason: "economy_off" };
  }
  if (!supabase) return { ok: true, skipped: true, reason: "no_backend" };

  // Look up the locked escrow row; refund based on its amount.
  const { data, error } = await supabase
    .from("escrow_locks")
    .select("amount_minor, status")
    .eq("scope", "tournament_entry")
    .eq("tournament_id", input.tournamentId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error || !data) {
    return { ok: true, skipped: true, reason: "no_escrow" };
  }
  if (data.status !== "locked") {
    return { ok: true, skipped: true, reason: `status_${data.status}` };
  }

  // Reuse the ledger via createLedgerEntry directly because
  // refundMatchEscrow is match-scoped. Manual ledger credit transfer.
  const ledger = await createLedgerEntry({
    userId: input.userId,
    amountMinor: Number(data.amount_minor),
    direction: "credit",
    pocket: "transfer",
    transactionType: "tournament_entry_refund",
    idempotencyKey: `tournament:${input.tournamentId}:entry:refund:${input.userId}`,
    referenceType: "tournament_escrow",
    referenceId: input.tournamentId,
    metadata: { tournamentId: input.tournamentId },
  });
  if (ledger.ok === false) {
    return { ok: false, reason: ledger.reason };
  }

  await supabase
    .from("escrow_locks")
    .update({ status: "refunded", refunded_at: new Date().toISOString() })
    .eq("scope", "tournament_entry")
    .eq("tournament_id", input.tournamentId)
    .eq("user_id", input.userId);

  await emitAuditEvent({
    eventType: "escrow.tournament_entry_refunded",
    actorKind: "realtime_server",
    actorId: input.userId,
    referenceType: "tournament_escrow",
    referenceId: input.tournamentId,
    payload: { tournamentId: input.tournamentId },
  });

  console.log(
    `[Refund] tournament entry refunded userId=${input.userId} tournamentId=${input.tournamentId}`
  );
  return { ok: true };
}

/**
 * Phase 12 TASK 5 — Refund every locked tournament-entry escrow for a
 * tournament. Used by tournament cancellation flows AND by the
 * reconciliation worker.
 *
 * Idempotent: rows already in a terminal state are skipped. Each refund
 * runs through `refundTournamentEntryEscrowByRow` which carries the
 * deterministic ledger idempotency key, so two parallel callers
 * collapse onto the same ledger entry.
 */
export type TournamentRefundFanoutSummary = {
  tournamentId: string;
  checked: number;
  refunded: number;
  skipped: number;
  failed: number;
  failures: Array<{ escrowId: string; userId: string; reason: string }>;
};

export async function refundAllTournamentEntryEscrows(
  tournamentId: string
): Promise<
  | { ok: true; summary: TournamentRefundFanoutSummary }
  | { ok: false; reason: string; summary?: TournamentRefundFanoutSummary }
> {
  if (getEconomyMode() === "off") {
    return {
      ok: true,
      summary: {
        tournamentId,
        checked: 0,
        refunded: 0,
        skipped: 0,
        failed: 0,
        failures: [],
      },
    };
  }
  if (!supabase) return { ok: false, reason: "no_backend" };

  const { data, error } = await supabase
    .from("escrow_locks")
    .select(
      "id, user_id, scope, room_code, match_instance, tournament_id, amount_minor, currency, status, locked_at, released_at, refunded_at"
    )
    .eq("scope", "tournament_entry")
    .eq("tournament_id", tournamentId)
    .in("status", ["locked", "pending"]);

  if (error) {
    return { ok: false, reason: "escrow_lookup_failed" };
  }

  const rows = (data ?? []) as EscrowRow[];
  const summary: TournamentRefundFanoutSummary = {
    tournamentId,
    checked: rows.length,
    refunded: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const row of rows) {
    if (row.status === "pending") {
      // Pending rows have no ledger debit yet — safe to mark failed.
      await supabase
        .from("escrow_locks")
        .update({ status: "failed", failure_reason: "tournament_cancelled" })
        .eq("id", row.id);
      summary.skipped += 1;
      continue;
    }

    const result = await refundTournamentEntryEscrowByRow(row);
    if (result.ok === false) {
      summary.failed += 1;
      summary.failures.push({
        escrowId: row.id,
        userId: row.user_id,
        reason: result.reason,
      });
      console.warn(
        `[Refund] fanout refund failed escrowId=${row.id} ` +
          `userId=${row.user_id} reason=${result.reason}`
      );
      continue;
    }
    summary.refunded += 1;
  }

  await emitAuditEvent({
    eventType: "tournament.refund_fanout",
    severity: summary.failed > 0 ? "warning" : "info",
    actorKind: "realtime_server",
    referenceType: "tournament",
    referenceId: tournamentId,
    payload: summary,
  });

  console.log(
    `[Refund] tournament refund fanout tournamentId=${tournamentId} ` +
      `checked=${summary.checked} refunded=${summary.refunded} ` +
      `skipped=${summary.skipped} failed=${summary.failed}`
  );

  return { ok: true, summary };
}

/**
 * Run tournament settlement on completion. Phase 12 hardened — refuses
 * to mark a prize-pool tournament `completed` until payout is
 * implemented. Free tournaments (prize_pool_minor=0) still settle.
 */
export async function settleTournamentEconomyForTournament(
  tournamentId: string
): Promise<EconomyResult> {
  if (getEconomyMode() === "off") {
    return { ok: true, skipped: true, reason: "economy_off" };
  }
  if (!supabase) return { ok: true, skipped: true, reason: "no_backend" };

  const result = await settleTournamentEconomy({ tournamentId });
  if (result.ok === false) {
    console.warn(
      `[Settlement] tournament settle failed tournamentId=${tournamentId} reason=${result.reason}`
    );
    return { ok: false, reason: result.reason };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------------------
 * Test wallet seeder
 * --------------------------------------------------------------------------- */

export type SeedTestWalletInput = {
  userId: string;
  amountMinor: number;
  note?: string;
};

/**
 * Adds available balance to a wallet via a ledger deposit. ONLY allowed
 * in `ECONOMY_TEST_MODE`. Idempotency key is `(userId, amountMinor,
 * note)` so re-calling with the same args collapses onto one row.
 *
 * This is the foundation for dev / QA flows. The internal HTTP endpoint
 * in `index.ts` enforces the same env-flag check plus the
 * realtime-internal secret.
 */
export async function seedTestWalletBalance(
  input: SeedTestWalletInput
): Promise<EconomyResult> {
  if (getEconomyMode() !== "test") {
    return { ok: false, reason: "test_mode_required" };
  }
  if (ECONOMY_REAL_MONEY_ENABLED) {
    return { ok: false, reason: "real_money_active" };
  }
  if (input.amountMinor <= 0) return { ok: false, reason: "invalid_amount" };

  const note = (input.note ?? "manual").replace(/[^a-z0-9_:-]/gi, "_");
  const idempotencyKey = `test_seed:${input.userId}:${input.amountMinor}:${note}`;

  const result = await createLedgerEntry({
    userId: input.userId,
    amountMinor: input.amountMinor,
    direction: "credit",
    pocket: "available",
    transactionType: "deposit",
    idempotencyKey,
    referenceType: "test_seed",
    referenceId: note,
    metadata: { mode: "test" },
  });

  if (result.ok === false) {
    return { ok: false, reason: result.reason };
  }

  await emitAuditEvent({
    eventType: "wallet.test_seeded",
    actorKind: "admin",
    actorId: input.userId,
    referenceType: "test_seed",
    referenceId: note,
    payload: { amountMinor: input.amountMinor, note },
  });

  console.log(
    `[Economy] test wallet seeded userId=${input.userId} amount=${input.amountMinor} note=${note}`
  );
  return { ok: true };
}
