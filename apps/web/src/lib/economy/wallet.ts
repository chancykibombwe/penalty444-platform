/**
 * Phase 10 — Wallet reads from the web client.
 *
 * READ-ONLY. The web client never inserts into `wallets`,
 * `wallet_ledger_entries`, `escrow_locks`, or `settlement_events`.
 *
 * RLS policy `wallets_self_read` and `wallet_ledger_self_read` scope
 * these queries to `auth.uid() = user_id`. If a user has no wallet row
 * yet, both fetchers return `null` and the UI shows the "wallet not
 * provisioned yet" placeholder — no auto-creation from the client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type WalletSnapshot = {
  id: string;
  currency: string;
  availableMinor: number;
  lockedMinor: number;
  status: "active" | "suspended" | "locked";
  updatedAt: string | null;
};

export type LedgerEntrySnapshot = {
  id: string;
  transactionType: string;
  direction: "credit" | "debit";
  amountMinor: number;
  balanceBeforeMinor: number;
  balanceAfterMinor: number;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
};

export async function fetchWalletSnapshot(
  client: SupabaseClient,
  userId: string,
  currency = "P4C"
): Promise<WalletSnapshot | null> {
  try {
    const { data, error } = await client
      .from("wallets")
      .select(
        "id, currency, available_balance_minor, locked_balance_minor, status, updated_at"
      )
      .eq("user_id", userId)
      .eq("currency", currency)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      currency: data.currency as string,
      availableMinor: Number(data.available_balance_minor ?? 0),
      lockedMinor: Number(data.locked_balance_minor ?? 0),
      status: (data.status as WalletSnapshot["status"]) ?? "active",
      updatedAt: (data.updated_at as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function fetchRecentLedger(
  client: SupabaseClient,
  userId: string,
  limit = 5
): Promise<LedgerEntrySnapshot[]> {
  try {
    const { data, error } = await client
      .from("wallet_ledger_entries")
      .select(
        "id, transaction_type, direction, amount_minor, balance_before_minor, balance_after_minor, reference_type, reference_id, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((row) => ({
      id: row.id as string,
      transactionType: row.transaction_type as string,
      direction: row.direction as "credit" | "debit",
      amountMinor: Number(row.amount_minor ?? 0),
      balanceBeforeMinor: Number(row.balance_before_minor ?? 0),
      balanceAfterMinor: Number(row.balance_after_minor ?? 0),
      referenceType: (row.reference_type as string | null) ?? null,
      referenceId: (row.reference_id as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  } catch {
    return [];
  }
}
