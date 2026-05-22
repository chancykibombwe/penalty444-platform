"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  fetchLiveMatchPreviews,
  type LiveMatchPreviewItem,
} from "../../lib/live/activity";
import { useVisibleInterval } from "../../lib/polling/useVisibleInterval";
import LivePulseBadge from "./LivePulseBadge";

/**
 * Live Match preview strip (Phase 7).
 *
 * Display-only. Shows tournament matches that are either currently being
 * played (`in_progress`) or queued up next (`ready`). No spectator wiring,
 * no socket subscriptions — clicking "Open" simply links into the existing
 * tournament page.
 */
type Props = {
  refreshMs?: number;
  limit?: number;
};

export default function LiveMatchPreview({
  refreshMs = 30_000,
  limit = 4,
}: Props) {
  const [items, setItems] = useState<LiveMatchPreviewItem[] | null>(null);

  useVisibleInterval(
    async (signal) => {
      const next = await fetchLiveMatchPreviews(supabase, limit);
      if (signal.aborted) return;
      setItems(next);
    },
    { intervalMs: refreshMs, deps: [limit] }
  );

  const isLoading = items === null;
  const list = items ?? [];

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black p-4 shadow-xl sm:p-5"
      aria-label="Live tournament matches"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LivePulseBadge
            label="Live Matches"
            tone="cyan"
            size="md"
            pulsing={list.some((item) => item.status === "in_progress")}
          />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Tournament bracket
          </p>
        </div>
        <Link
          href="/tournaments"
          className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
        >
          Tournaments →
        </Link>
      </div>

      {isLoading ? (
        <PreviewSkeleton />
      ) : list.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          Preparing live arena matches…
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {list.map((item) => (
            <LiveMatchCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveMatchCard({ item }: { item: LiveMatchPreviewItem }) {
  const isLive = item.status === "in_progress";
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border px-3.5 py-3 ${
        item.isFinal
          ? "border-yellow-300/55 bg-yellow-500/5 shadow-[0_0_24px_rgba(250,204,21,0.18)]"
          : isLive
            ? "border-cyan-400/45 bg-cyan-500/5 shadow-[0_0_18px_rgba(34,211,238,0.18)]"
            : "border-zinc-800/80 bg-zinc-950/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
          {item.tournamentName}
        </span>
        {item.isFinal ? (
          <LivePulseBadge label="Final" tone="amber" size="sm" pulsing={isLive} />
        ) : (
          <LivePulseBadge
            label={isLive ? "Live" : item.roundLabel}
            tone={isLive ? "cyan" : "neutral"}
            size="sm"
            pulsing={isLive}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-white sm:text-base">
          {item.playerOne}
        </span>
        <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          vs
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-sm font-bold text-white sm:text-base">
          {item.playerTwo}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-zinc-500">
          {item.isFinal
            ? "Final showdown"
            : isLive
              ? "Match in progress"
              : "Up next"}
        </span>
        {item.roomCode ? (
          <Link
            href={`/watch/${item.roomCode.toUpperCase()}`}
            className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
              item.isFinal
                ? "border-yellow-300/55 bg-yellow-500/10 text-yellow-100 hover:bg-yellow-500/20"
                : "border-cyan-500/40 bg-cyan-500/5 text-cyan-200 hover:bg-cyan-500/15 hover:text-cyan-100"
            }`}
          >
            ▶ Watch
          </Link>
        ) : (
          <Link
            href={`/tournaments/${item.tournamentId}`}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:bg-zinc-800/80"
          >
            Open
          </Link>
        )}
      </div>
    </li>
  );
}

function PreviewSkeleton() {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 2 }).map((_, idx) => (
        <li
          key={idx}
          className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 px-3.5 py-3"
        >
          <div className="flex items-center justify-between">
            <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-800/80" />
            <div className="h-3 w-12 animate-pulse rounded bg-zinc-800/80" />
          </div>
          <div className="flex items-center justify-between">
            <div className="h-4 w-2/5 animate-pulse rounded bg-zinc-800/80" />
            <div className="h-3 w-6 animate-pulse rounded bg-zinc-800/60" />
            <div className="h-4 w-2/5 animate-pulse rounded bg-zinc-800/80" />
          </div>
          <div className="flex items-center justify-between">
            <div className="h-3 w-1/4 animate-pulse rounded bg-zinc-800/60" />
            <div className="h-6 w-12 animate-pulse rounded bg-zinc-800/80" />
          </div>
        </li>
      ))}
    </ul>
  );
}
