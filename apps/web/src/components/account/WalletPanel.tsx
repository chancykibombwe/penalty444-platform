"use client";

/**
 * Phase 10 — Wallet UI foundation.
 *
 * Read-only summary of the player's wallet (available + locked balance)
 * and the most recent ledger entries. When no wallet row exists yet
 * (which is the case for every user during Phase 10) the panel shows
 * a premium "Arena wallet · Coming online" placeholder.
 *
 * Deposits / withdrawals are intentionally absent. Every CTA in the
 * UI is a "Coming soon" badge — the frontend NEVER initiates a money
 * movement.
 */

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  fetchRecentLedger,
  fetchWalletSnapshot,
  type LedgerEntrySnapshot,
  type WalletSnapshot,
} from "../../lib/economy/wallet";
import { formatBalanceSplit, formatMinorAmount } from "../../lib/economy/format";
import { describeEconomyMode, getPublicEconomyMode } from "../../lib/economy/mode";

type Props = {
  userId: string | null;
};

const MODE_BADGE_CLASS: Record<"neutral" | "test" | "live", string> = {
  neutral: "border-zinc-700/80 bg-zinc-900/70 text-zinc-300",
  test: "border-cyan-400/45 bg-cyan-500/10 text-cyan-200",
  live: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200",
};

const PILL_BORDER: Record<string, string> = {
  credit: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  debit: "border-rose-500/40 bg-rose-500/10 text-rose-200",
};

const TX_LABEL: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  escrow_lock: "Stake locked",
  escrow_release: "Stake released",
  escrow_payout: "Match payout",
  escrow_refund: "Stake refund",
  tournament_entry_fee: "Tournament entry",
  tournament_prize_payout: "Tournament prize",
  tournament_entry_refund: "Tournament refund",
  manual_adjustment: "Adjustment",
};

function txLabel(type: string): string {
  return TX_LABEL[type] ?? type.replace(/_/g, " ");
}

function formatLedgerDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function WalletPanel({ userId }: Props) {
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [ledger, setLedger] = useState<LedgerEntrySnapshot[]>([]);
  const [pendingEscrowCount, setPendingEscrowCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const economyMode = getPublicEconomyMode();
  const modeMeta = describeEconomyMode(economyMode);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load(uid: string) {
      const [walletResult, ledgerResult, escrowResult] = await Promise.all([
        fetchWalletSnapshot(supabase, uid),
        fetchRecentLedger(supabase, uid, 5),
        supabase
          .from("escrow_locks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .eq("status", "locked"),
      ]);
      if (cancelled) return;
      setWallet(walletResult);
      setLedger(ledgerResult);
      setPendingEscrowCount(escrowResult.count ?? 0);
      setLoading(false);
    }

    void load(userId);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const available = formatBalanceSplit(wallet?.availableMinor ?? 0);
  const locked = formatBalanceSplit(wallet?.lockedMinor ?? 0);
  const total = formatBalanceSplit(
    (wallet?.availableMinor ?? 0) + (wallet?.lockedMinor ?? 0)
  );
  const currency = wallet?.currency ?? "P4C";

  return (
    <section
      className="overflow-hidden rounded-3xl border border-yellow-500/30 bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
      aria-label="Arena Wallet"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-yellow-400/50 bg-yellow-500/10 text-base font-black text-yellow-200 shadow-[0_0_18px_rgba(234,179,8,0.35)]"
            aria-hidden
          >
            ⌬
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.32em] text-yellow-300/80">
              Arena Wallet
            </p>
            <p className="text-sm font-bold text-white">
              Competitive balance · {currency}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${MODE_BADGE_CLASS[modeMeta.tone]}`}
            title={modeMeta.hint}
          >
            {modeMeta.label}
          </span>
          <span className="inline-flex items-center rounded-full border border-zinc-700/80 bg-zinc-900/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
            {wallet ? wallet.status : "Provisioning"}
          </span>
        </div>
      </header>

      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-yellow-400/30 bg-yellow-500/8 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] lg:col-span-1">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-yellow-200">
            Total Balance
          </p>
          <p className="mt-3 flex items-baseline gap-1 text-4xl font-black tabular-nums text-white">
            <span>{total.major}</span>
            <span className="text-2xl text-zinc-400">.{total.cents}</span>
            <span className="ml-2 text-xs font-bold uppercase tracking-[0.22em] text-yellow-200/80">
              {currency}
            </span>
          </p>
          <p className="mt-2 text-[11px] font-semibold text-zinc-500">
            Available + reserved in escrow.
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-emerald-400/30 bg-emerald-500/8 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">
            Available Balance
          </p>
          <p className="mt-3 flex items-baseline gap-1 text-4xl font-black tabular-nums text-white">
            <span>{available.major}</span>
            <span className="text-2xl text-zinc-400">.{available.cents}</span>
            <span className="ml-2 text-xs font-bold uppercase tracking-[0.22em] text-emerald-200/80">
              {currency}
            </span>
          </p>
          <p className="mt-2 text-[11px] font-semibold text-zinc-500">
            Spendable in matches and tournaments.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-amber-400/30 bg-amber-500/8 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">
            Locked in Escrow
          </p>
          <p className="mt-3 flex items-baseline gap-1 text-4xl font-black tabular-nums text-white">
            <span>{locked.major}</span>
            <span className="text-2xl text-zinc-400">.{locked.cents}</span>
            <span className="ml-2 text-xs font-bold uppercase tracking-[0.22em] text-amber-200/80">
              {currency}
            </span>
          </p>
          <p className="mt-2 text-[11px] font-semibold text-zinc-500">
            {pendingEscrowCount > 0
              ? `${pendingEscrowCount} active reservation${pendingEscrowCount === 1 ? "" : "s"}.`
              : "Reserved for live stakes and tournament entries."}
          </p>
        </div>
      </div>

      <div className="border-t border-zinc-800/80 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
            Recent Activity
          </p>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
            Read-only
          </span>
        </div>

        {loading ? (
          <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-5 text-center text-sm font-semibold text-zinc-500">
            Loading wallet activity…
          </p>
        ) : !wallet ? (
          <p className="mt-4 rounded-2xl border border-dashed border-yellow-500/30 bg-yellow-500/5 px-4 py-5 text-center text-sm font-semibold text-yellow-100/80">
            Paid wallet features are not live yet. All beta matches and
            tournaments are Free Play.
          </p>
        ) : ledger.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-5 text-center text-sm font-semibold text-zinc-500">
            No transactions yet. Activity will appear here once paid features
            launch.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {ledger.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-black/45 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">
                    {txLabel(entry.transactionType)}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {formatLedgerDate(entry.createdAt)}
                    {entry.referenceType
                      ? ` · ${entry.referenceType.replace(/_/g, " ")}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                      PILL_BORDER[entry.direction] ??
                      "border-zinc-700 bg-zinc-900 text-zinc-300"
                    }`}
                  >
                    {entry.direction === "credit" ? "+" : "−"}
                    {formatMinorAmount(entry.amountMinor, currency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2 border-t border-zinc-800/80 px-5 py-4 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-black/45 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-white">Deposits</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Mobile money &amp; card top-ups.
            </p>
          </div>
          <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Coming soon
          </span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-black/45 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-white">Withdrawals</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Withdraw arena winnings.
            </p>
          </div>
          <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Coming soon
          </span>
        </div>
      </div>
    </section>
  );
}
