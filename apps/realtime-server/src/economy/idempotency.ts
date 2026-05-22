/**
 * Phase 10 — Economy idempotency helpers.
 *
 * Deterministic, derivable idempotency keys. The key is the contract: same
 * action against same entity = same key. Retries collapse onto the same row
 * via the unique constraints in the economy migration.
 *
 * Format:
 *   <scope>:<entityId>[:<sub>][:<userId>]
 *
 * Examples:
 *   match:ABCD12:1:lock:9d3c... (room=ABCD12, match_instance=1, action=lock, user=9d3c...)
 *   match:ABCD12:1:payout      (room=ABCD12, match_instance=1, action=payout)
 *   tournament:abc-123:entry:lock:9d3c...
 *   tournament:abc-123:payout:1                (1st place)
 */

import { supabase } from "../config";

export type SettlementType =
  | "match_payout"
  | "match_refund"
  | "match_draw_refund"
  | "tournament_payout"
  | "tournament_refund";

/* ---------------------------------------------------------------------------
 * Key builders
 * --------------------------------------------------------------------------- */

export function createMatchEscrowKey(
  roomCode: string,
  matchInstance: number,
  action: "lock" | "release" | "refund" | "payout",
  userId?: string
): string {
  const base = `match:${roomCode}:${matchInstance}:${action}`;
  return userId ? `${base}:${userId}` : base;
}

export function createTournamentEntryEscrowKey(
  tournamentId: string,
  action: "lock" | "release" | "refund",
  userId: string
): string {
  return `tournament:${tournamentId}:entry:${action}:${userId}`;
}

export function createTournamentPayoutKey(
  tournamentId: string,
  position: number,
  userId: string
): string {
  return `tournament:${tournamentId}:payout:${position}:${userId}`;
}

export function createSettlementKey(
  scope: "match" | "tournament",
  ids: { roomCode?: string; matchInstance?: number; tournamentId?: string },
  settlementType: SettlementType
): string {
  if (scope === "match") {
    return `match:${ids.roomCode}:${ids.matchInstance}:settle:${settlementType}`;
  }
  return `tournament:${ids.tournamentId}:settle:${settlementType}`;
}

/* ---------------------------------------------------------------------------
 * Pre-flight idempotency checks
 * --------------------------------------------------------------------------- */

export type SettlementCheckResult =
  | { processed: false }
  | { processed: true; status: string; processedAt: string | null };

/**
 * Returns whether a settlement event has already been recorded for the
 * given match instance + type. Used as a pre-flight guard before
 * spending compute on building ledger entries.
 *
 * Note: this is a soft check. The hard guarantee is the
 * UNIQUE (room_code, match_instance, settlement_type) index on
 * settlement_events — duplicate inserts return 23505.
 */
export async function assertMatchSettlementNotProcessed(
  roomCode: string,
  matchInstance: number,
  settlementType: SettlementType
): Promise<SettlementCheckResult> {
  if (!supabase) return { processed: false };

  const { data, error } = await supabase
    .from("settlement_events")
    .select("status, processed_at")
    .eq("scope", "match")
    .eq("room_code", roomCode)
    .eq("match_instance", matchInstance)
    .eq("settlement_type", settlementType)
    .maybeSingle();

  if (error || !data) return { processed: false };
  return {
    processed: true,
    status: data.status as string,
    processedAt: (data.processed_at as string | null) ?? null,
  };
}

export async function assertTournamentSettlementNotProcessed(
  tournamentId: string,
  settlementType: SettlementType
): Promise<SettlementCheckResult> {
  if (!supabase) return { processed: false };

  const { data, error } = await supabase
    .from("settlement_events")
    .select("status, processed_at")
    .eq("scope", "tournament")
    .eq("tournament_id", tournamentId)
    .eq("settlement_type", settlementType)
    .maybeSingle();

  if (error || !data) return { processed: false };
  return {
    processed: true,
    status: data.status as string,
    processedAt: (data.processed_at as string | null) ?? null,
  };
}

/**
 * Postgres unique-violation error code. Callers should treat this code as
 * a benign duplicate (same as Sprint 1 `saveMatchResult` pattern).
 */
export const UNIQUE_VIOLATION_CODE = "23505";

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === UNIQUE_VIOLATION_CODE;
}
