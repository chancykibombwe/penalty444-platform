"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import RequireAuth from "../../../components/auth/RequireAuth";
import MatchResultBadge from "../../../components/matches/MatchResultBadge";
import { supabase } from "../../../lib/supabase/client";
import {
  fetchMatchById,
  formatMatchDateTime,
  type MatchDetail,
} from "../../../lib/matches/matchHistory";

const RESULT_HEADLINE: Record<MatchDetail["result"], string> = {
  W: "Victory",
  D: "Draw",
  L: "Defeat",
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[#1B2433] px-4 py-3 first:border-t-0">
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-sm font-semibold text-white">
        {value}
      </span>
    </div>
  );
}

function MatchDetailContent() {
  const params = useParams();
  const matchId = (params.id as string) ?? "";

  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function load() {
      setLoading(true);
      setError("");
      setNotFound(false);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelledRef.current) return;

      const viewerId = session?.user.id ?? null;
      if (!viewerId) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const result = await fetchMatchById(matchId, viewerId);
      if (cancelledRef.current) return;

      if (result.ok) {
        setDetail(result.detail);
      } else if (result.notFound) {
        setNotFound(true);
      } else {
        setError(result.error);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [matchId]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24 sm:pb-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400/70">
          444 Arena · Free Play Beta
        </p>
        <Link
          href="/matches"
          className="shrink-0 rounded-lg border border-zinc-700/80 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
        >
          ← Match History
        </Link>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#1B2433] bg-[#0D1420] px-4 py-10 text-center text-sm text-zinc-500">
          Loading match…
        </div>
      ) : notFound ? (
        <div className="rounded-2xl border border-[#1B2433] bg-[#0D1420] px-4 py-10 text-center">
          <p className="text-sm font-semibold text-zinc-300">Match not found</p>
          <p className="mt-1 text-xs text-zinc-500">
            This match doesn&apos;t exist or isn&apos;t part of your history.
          </p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-[#1B2433] bg-[#0D1420] px-4 py-10 text-center text-sm text-red-300/80">
          {error}
        </div>
      ) : detail ? (
        <>
          {/* Result hero */}
          <div className="overflow-hidden rounded-2xl border border-[#1B2433] bg-[#0D1420] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-4">
              <MatchResultBadge result={detail.result} />
              <div className="min-w-0">
                <p className="text-lg font-black text-white">
                  {RESULT_HEADLINE[detail.result]}
                </p>
                <p className="truncate text-sm text-zinc-400">
                  vs {detail.opponentUsername}
                </p>
              </div>
            </div>

            {/* Score */}
            <div className="mt-4 flex items-center justify-center gap-4 rounded-xl border border-[#1B2433] bg-black/30 py-4">
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  {detail.myUsername}
                </p>
                <p className="mt-1 text-3xl font-black tabular-nums text-white">
                  {detail.myScore}
                </p>
              </div>
              <span className="text-xl font-black text-zinc-600">–</span>
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  {detail.opponentUsername}
                </p>
                <p className="mt-1 text-3xl font-black tabular-nums text-white">
                  {detail.opponentScore}
                </p>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="overflow-hidden rounded-2xl border border-[#1B2433] bg-[#0D1420] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <DetailRow label="Result" value={RESULT_HEADLINE[detail.result]} />
            <DetailRow label="Match type" value={detail.matchTypeLabel} />
            <DetailRow
              label="Final score"
              value={`${detail.myScore} – ${detail.opponentScore}`}
            />
            <DetailRow label="Opponent" value={detail.opponentUsername} />
            <DetailRow label="Room code" value={detail.roomCode} />
            <DetailRow
              label="Played"
              value={formatMatchDateTime(detail.createdAt)}
            />
          </div>

          {/* Honest "not stored" notes — no invented data. */}
          <div className="space-y-2 rounded-2xl border border-[#1B2433] bg-[#0D1420]/60 px-4 py-3.5">
            <p className="text-xs text-zinc-500">
              Round-by-round details are not available for this match.
            </p>
            <p className="text-xs text-zinc-500">
              Per-match rating change isn&apos;t recorded. See your overall
              progress on the{" "}
              <Link
                href="/leaderboard"
                className="font-semibold text-[#9AD2FF] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3B9EFF]/70"
              >
                leaderboard
              </Link>
              .
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function MatchDetailPage() {
  return (
    <RequireAuth>
      <MatchDetailContent />
    </RequireAuth>
  );
}
