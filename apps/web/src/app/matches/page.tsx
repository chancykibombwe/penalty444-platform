"use client";

import Link from "next/link";
import RequireAuth from "../../components/auth/RequireAuth";
import MatchHistoryList from "../../components/matches/MatchHistoryList";

export default function MatchesPage() {
  return (
    <RequireAuth>
      <div className="mx-auto max-w-4xl space-y-4 pb-24 sm:pb-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400/70">
              444 Arena · Free Play Beta
            </p>
            <h1 className="text-2xl font-black text-white">Match History</h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              Your completed Penalty444 matches. Stats are for beta testing.
            </p>
          </div>
          <Link
            href="/account"
            className="shrink-0 rounded-lg border border-zinc-700/80 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
          >
            ← Account
          </Link>
        </div>

        <MatchHistoryList />
      </div>
    </RequireAuth>
  );
}
