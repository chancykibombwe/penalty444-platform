/**
 * Phase 11 — Browser-side caller for `/api/economy/tournament-entry`.
 *
 * Used by tournament join/withdraw UI to lock or refund an entry
 * escrow before / after writing the `tournament_entries` row.
 *
 * Always returns a benign result for free tournaments / economy off so
 * callers can keep the registration flow simple.
 */

import { supabase } from "../supabase/client";

export type ClientEconomyResult =
  | {
      ok: true;
      /** True when economy was skipped (free tournament, economy off). */
      skipped?: boolean;
      entryFeeMinor?: number;
    }
  | { ok: false; error: string };

async function postEconomy(payload: {
  action: "lock" | "refund";
  tournamentId: string;
}): Promise<ClientEconomyResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      return { ok: false, error: "not_authenticated" };
    }

    const resp = await fetch("/api/economy/tournament-entry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      return { ok: false, error: String(data.error ?? "request_failed") };
    }
    return {
      ok: true,
      skipped: Boolean(data.skipped),
      entryFeeMinor:
        typeof data.entryFeeMinor === "number"
          ? data.entryFeeMinor
          : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}

export function lockTournamentEntry(tournamentId: string) {
  return postEconomy({ action: "lock", tournamentId });
}

export function refundTournamentEntry(tournamentId: string) {
  return postEconomy({ action: "refund", tournamentId });
}
