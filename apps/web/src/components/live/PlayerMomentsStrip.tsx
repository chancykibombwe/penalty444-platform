"use client";

import Link from "next/link";
import { useState } from "react";
import {
  fetchRecentPlayerMoments,
  type RecentPlayerMoment,
} from "../../lib/live/activity";
import { useVisibleInterval } from "../../lib/polling/useVisibleInterval";
import { supabase } from "../../lib/supabase/client";
import ExpandToggle from "../ui/ExpandToggle";
import LivePulseBadge from "./LivePulseBadge";

/**
 * PlayerMomentsStrip — recent champions and recent winners (read-only).
 *
 * Pulls from `fetchRecentPlayerMoments` and renders a compact celebratory
 * strip. No fake stats: if no data is available, shows the official
 * Phase 8 placeholder copy.
 */
type Props = {
  refreshMs?: number;
  limit?: number;
};

const TONE_BG: Record<RecentPlayerMoment["tone"], string> = {
  champion: "border-yellow-300/55 bg-yellow-500/8",
  win: "border-emerald-400/40 bg-emerald-500/8",
  info: "border-[#1B2433] bg-[#111827]/60",
  promotion: "border-violet-400/45 bg-violet-500/10",
};

const TONE_TEXT: Record<RecentPlayerMoment["tone"], string> = {
  champion: "text-yellow-100",
  win: "text-emerald-100",
  info: "text-zinc-100",
  promotion: "text-violet-100",
};

const TONE_ICON: Record<RecentPlayerMoment["tone"], string> = {
  champion: "🏆",
  win: "⚽",
  info: "•",
  promotion: "↑",
};

export default function PlayerMomentsStrip({
  refreshMs = 45_000,
  limit = 6,
}: Props) {
  const [items, setItems] = useState<RecentPlayerMoment[] | null>(null);

  useVisibleInterval(
    async (signal) => {
      const next = await fetchRecentPlayerMoments(supabase, limit);
      if (signal.aborted) return;
      setItems(next);
    },
    { intervalMs: refreshMs, deps: [limit] }
  );

  const isLoading = items === null;
  const list = items ?? [];

  return (
    <section
      className="rounded-3xl border border-[#1B2433] bg-gradient-to-br from-[#0A0E14] via-[#0A0E14] to-black p-3.5 shadow-xl sm:p-4"
      aria-label="Featured player moments"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LivePulseBadge
            label="Player Moments"
            tone="amber"
            pulsing={false}
            size="md"
          />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Champions · Wins · Promotions
          </p>
        </div>
        <Link
          href="/leaderboard"
          className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
        >
          Leaderboard →
        </Link>
      </div>

      {isLoading ? (
        <MomentsSkeleton />
      ) : list.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-[#1B2433] bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          Rising competitors are warming up…
        </p>
      ) : (
        <div className="mt-3">
          <ul className="grid gap-2">
            {list.slice(0, 2).map((moment) => (
              <MomentItem key={moment.id} moment={moment} />
            ))}
          </ul>
          {list.length > 2 ? (
            <ExpandToggle
              label={`+${list.length - 2} more moment${list.length - 2 === 1 ? "" : "s"}`}
              expandedLabel="Show less"
            >
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {list.slice(2).map((moment) => (
                  <MomentItem key={moment.id} moment={moment} />
                ))}
              </ul>
            </ExpandToggle>
          ) : null}
        </div>
      )}
    </section>
  );
}

function MomentItem({ moment }: { moment: RecentPlayerMoment }) {
  const body = (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${TONE_BG[moment.tone]}`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-black/40 text-lg ${TONE_TEXT[moment.tone]}`}
        aria-hidden
      >
        {TONE_ICON[moment.tone]}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-black ${TONE_TEXT[moment.tone]}`}>
          {moment.headline}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-400">
          {moment.context}
        </p>
      </div>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        {moment.relativeTime}
      </span>
    </div>
  );

  return (
    <li>
      {moment.href ? (
        <Link
          href={moment.href}
          className="block transition-transform hover:-translate-y-0.5"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function MomentsSkeleton() {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, idx) => (
        <li
          key={idx}
          className="flex items-center gap-3 rounded-2xl border border-[#1B2433] bg-[#0D1420]/65 px-3 py-2.5"
        >
          <div className="h-8 w-8 animate-pulse rounded-xl bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/5 animate-pulse rounded bg-zinc-800/80" />
            <div className="h-2 w-2/5 animate-pulse rounded bg-zinc-800/60" />
          </div>
          <div className="h-3 w-10 animate-pulse rounded bg-zinc-800/60" />
        </li>
      ))}
    </ul>
  );
}
