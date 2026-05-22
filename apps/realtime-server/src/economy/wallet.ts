/**
 * Phase 10 — Wallet service layer (server-side only).
 *
 * Provides the ONLY paths that mutate `wallets`. All writes go through
 * `createLedgerEntry` which atomically:
 *
 *   1. Verifies the wallet exists (or bootstraps it on first credit).
 *   2. Calls the service-role-only RPC `economy_apply_ledger_entry`
 *      which inserts the ledger row AND updates the wallet balance
 *      inside a single transaction.
 *   3. Returns the freshly-applied ledger row.
 *
 * `wallets.available_balance_minor` / `locked_balance_minor` exist as a
 * materialised projection for read speed. Their correctness is invariant
 * over the ledger; a future reconciliation job MUST assert that.
 *
 * IMPORTANT:
 *   - Amounts MUST be in minor units (e.g. cents).
 *   - Amounts MUST be positive; direction encodes credit/debit.
 *   - Frontend payloads are NEVER trusted for amounts.
 */

import { supabase } from "../config";
import {
  DEFAULT_CURRENCY,
  ECONOMY_ENABLED,
  MAX_LEDGER_AMOUNT_MINOR,
} from "./config";
import { isUniqueViolation } from "./idempotency";
import { emitAuditEvent } from "./audit";

export type WalletRow = {
  id: string;
  user_id: string;
  currency: string;
  available_balance_minor: number;
  locked_balance_minor: number;
  status: "active" | "suspended" | "locked";
};

export type LedgerDirection = "credit" | "debit";

export type LedgerTransactionType =
  | "deposit"
  | "withdrawal"
  | "escrow_lock"
  | "escrow_release"
  | "escrow_payout"
  | "escrow_refund"
  | "tournament_entry_fee"
  | "tournament_prize_payout"
  | "tournament_entry_refund"
  | "manual_adjustment";

export type LedgerEntryInput = {
  userId: string;
  amountMinor: number;
  direction: LedgerDirection;
  transactionType: LedgerTransactionType;
  /**
   * Which balance pocket the entry affects:
   *   - "available" → moves available_balance_minor
   *   - "locked"    → moves locked_balance_minor (escrow operations)
   *   - "transfer"  → moves available ↔ locked atomically
   */
  pocket: "available" | "locked" | "transfer";
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

export type LedgerEntryResult =
  | { ok: true; created: boolean; row: LedgerRow }
  | { ok: false; reason: string };

export type LedgerRow = {
  id: string;
  wallet_id: string;
  user_id: string;
  transaction_type: string;
  direction: LedgerDirection;
  amount_minor: number;
  balance_before_minor: number;
  balance_after_minor: number;
  idempotency_key: string;
  created_at: string;
};

/* ---------------------------------------------------------------------------
 * Wallet bootstrap
 * --------------------------------------------------------------------------- */

/**
 * Read a wallet for a user. Returns null when economy is disabled or
 * the wallet does not exist yet. Safe to call from the frontend
 * read path because RLS scopes it to `auth.uid() = user_id`.
 */
export async function getWallet(
  userId: string,
  currency: string = DEFAULT_CURRENCY
): Promise<WalletRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("wallets")
    .select(
      "id, user_id, currency, available_balance_minor, locked_balance_minor, status"
    )
    .eq("user_id", userId)
    .eq("currency", currency)
    .maybeSingle();
  if (error || !data) return null;
  return data as WalletRow;
}

export async function getWalletBalance(
  userId: string,
  currency: string = DEFAULT_CURRENCY
): Promise<{ available: number; locked: number } | null> {
  const wallet = await getWallet(userId, currency);
  if (!wallet) return null;
  return {
    available: wallet.available_balance_minor,
    locked: wallet.locked_balance_minor,
  };
}

/**
 * Service-role bootstrap. Idempotent — collision on
 * `wallets_user_currency_unique` is treated as the wallet already
 * existing and we re-read.
 */
export async function getOrCreateWallet(
  userId: string,
  currency: string = DEFAULT_CURRENCY
): Promise<WalletRow | null> {
  if (!supabase) return null;

  const existing = await getWallet(userId, currency);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("wallets")
    .insert({ user_id: userId, currency })
    .select(
      "id, user_id, currency, available_balance_minor, locked_balance_minor, status"
    )
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return getWallet(userId, currency);
    }
    console.error(
      `[Economy] wallet bootstrap failed userId=${userId} currency=${currency}:`,
      error
    );
    return null;
  }

  await emitAuditEvent({
    eventType: "wallet.created",
    actorKind: "system",
    actorId: userId,
    referenceType: "wallet",
    referenceId: (data as WalletRow).id,
    payload: { currency },
  });

  console.log(
    `[Economy] wallet created userId=${userId} currency=${currency} walletId=${(data as WalletRow).id}`
  );

  return data as WalletRow;
}

/* ---------------------------------------------------------------------------
 * Ledger writes
 * --------------------------------------------------------------------------- */

/**
 * Insert a ledger entry and project the new balance onto `wallets`.
 *
 * Returns `{ ok: true, created: false }` when the same idempotency key
 * has already been written — the existing row is fetched and returned.
 *
 * All non-trivial validation is server-side: amount range, positive,
 * known transaction type, and the unique idempotency key.
 */
export async function createLedgerEntry(
  input: LedgerEntryInput
): Promise<LedgerEntryResult> {
  if (!supabase) return { ok: false, reason: "no_backend" };
  if (!ECONOMY_ENABLED) return { ok: false, reason: "economy_disabled" };

  if (
    !Number.isFinite(input.amountMinor) ||
    !Number.isInteger(input.amountMinor) ||
    input.amountMinor <= 0 ||
    input.amountMinor > MAX_LEDGER_AMOUNT_MINOR
  ) {
    return { ok: false, reason: "invalid_amount" };
  }

  const wallet = await getOrCreateWallet(input.userId);
  if (!wallet) return { ok: false, reason: "wallet_unavailable" };
  if (wallet.status !== "active") {
    return { ok: false, reason: `wallet_status_${wallet.status}` };
  }

  const { data, error } = await supabase.rpc("economy_apply_ledger_entry", {
    p_wallet_id: wallet.id,
    p_user_id: input.userId,
    p_transaction_type: input.transactionType,
    p_direction: input.direction,
    p_amount_minor: input.amountMinor,
    p_pocket: input.pocket,
    p_idempotency_key: input.idempotencyKey,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    if (isUniqueViolation(error)) {
      const existing = await fetchLedgerByIdempotencyKey(
        input.userId,
        input.idempotencyKey
      );
      if (existing) {
        console.log(
          `[Economy] ledger duplicate collapsed userId=${input.userId} key=${input.idempotencyKey}`
        );
        return { ok: true, created: false, row: existing };
      }
    }
    console.error(
      `[Economy] ledger write failed userId=${input.userId} key=${input.idempotencyKey}:`,
      error
    );
    await emitAuditEvent({
      eventType: "ledger.write_failed",
      severity: "error",
      actorKind: "realtime_server",
      actorId: input.userId,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      payload: {
        idempotencyKey: input.idempotencyKey,
        transactionType: input.transactionType,
        error: String(error.message ?? error),
      },
    });
    return { ok: false, reason: "rpc_failed" };
  }

  const row = (data as LedgerRow[] | LedgerRow | null) ?? null;
  const ledgerRow = Array.isArray(row) ? row[0] : row;

  if (!ledgerRow) {
    return { ok: false, reason: "no_row_returned" };
  }

  await emitAuditEvent({
    eventType: "ledger.entry_created",
    actorKind: "realtime_server",
    actorId: input.userId,
    referenceType: input.referenceType ?? "wallet",
    referenceId: input.referenceId ?? wallet.id,
    payload: {
      idempotencyKey: input.idempotencyKey,
      transactionType: input.transactionType,
      direction: input.direction,
      amountMinor: input.amountMinor,
      pocket: input.pocket,
    },
  });

  console.log(
    `[Economy] ledger applied userId=${input.userId} type=${input.transactionType} ` +
      `dir=${input.direction} amount=${input.amountMinor} key=${input.idempotencyKey}`
  );

  return { ok: true, created: true, row: ledgerRow };
}

async function fetchLedgerByIdempotencyKey(
  userId: string,
  idempotencyKey: string
): Promise<LedgerRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("wallet_ledger_entries")
    .select(
      "id, wallet_id, user_id, transaction_type, direction, amount_minor, balance_before_minor, balance_after_minor, idempotency_key, created_at"
    )
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || !data) return null;
  return data as LedgerRow;
}
