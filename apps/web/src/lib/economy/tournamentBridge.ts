/**
 * Phase 11 — Web → realtime-server bridge for tournament entry escrow.
 *
 * The web client cannot mutate `escrow_locks` or `wallet_ledger_entries`
 * (RLS denies it). All economy writes go through the realtime server's
 * internal endpoints, which we proxy through Next.js API routes so the
 * `REALTIME_INTERNAL_SECRET` never reaches the browser.
 *
 * Returns `{ ok: true, skipped: true }` for free tournaments / economy
 * off. Callers should NOT block the user flow on a skipped lock — the
 * UX is "if there's nothing to charge, proceed".
 */

const REALTIME_BASE = process.env.REALTIME_INTERNAL_URL ?? "http://localhost:4000";

function getSecret(): string {
  const secret = process.env.REALTIME_INTERNAL_SECRET ?? "";
  if (!secret) {
    throw new Error("REALTIME_INTERNAL_SECRET is not configured.");
  }
  return secret;
}

export type EconomyBridgeResult =
  | { ok: true; skipped?: boolean; entryFeeMinor?: number }
  | { ok: false; error: string };

export async function lockTournamentEntryViaRealtime(payload: {
  userId: string;
  tournamentId: string;
}): Promise<EconomyBridgeResult> {
  try {
    const resp = await fetch(
      `${REALTIME_BASE}/internal/economy/tournament-entry/lock`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-realtime-internal-secret": getSecret(),
        },
        body: JSON.stringify(payload),
      }
    );
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      return { ok: false, error: String(data.error ?? "lock_failed") };
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

export async function refundTournamentEntryViaRealtime(payload: {
  userId: string;
  tournamentId: string;
}): Promise<EconomyBridgeResult> {
  try {
    const resp = await fetch(
      `${REALTIME_BASE}/internal/economy/tournament-entry/refund`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-realtime-internal-secret": getSecret(),
        },
        body: JSON.stringify(payload),
      }
    );
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      return { ok: false, error: String(data.error ?? "refund_failed") };
    }
    return { ok: true, skipped: Boolean(data.skipped) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}
