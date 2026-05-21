"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  fetchPlatformActivity,
  type ActivityEvent,
  type ActivityEventTone,
} from "../../lib/live/activity";
import LivePulseBadge from "./LivePulseBadge";

/**
 * Global Live Activity Feed (Phase 7).
 *
 * Pulls real recent events from `match_results` + `tournaments` and renders
 * them with the platform's neon live grammar. Polls every `refreshMs` so the
 * feed feels continuously alive without taking on a websocket dependency.
 *
 * Empty / loading copy uses "Preparing live arena activity..." — never
 * "No activity" — per Phase 7 spec.
 */
type Props = {
  /** Poll interval in ms. Defaults to 30s. */
  refreshMs?: number;
  /** Optional cap on rendered events. */
  limit?: number;
  /** Optional "See more" href; hidden when omitted. */
  seeMoreHref?: string;
};

const TONE_BORDER: Record<ActivityEventTone, string> = {
  live: "border-cyan-400/45 bg-cyan-500/8",
  win: "border-emerald-400/40 bg-emerald-500/8",
  info: "border-zinc-700/80 bg-zinc-900/60",
  champion: "border-yellow-300/55 bg-yellow-500/8",
  promotion: "border-violet-400/45 bg-violet-500/10",
};

const TONE_DOT: Record<ActivityEventTone, string> = {
  live: "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]",
  win: "bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
  info: "bg-zinc-400",
  champion: "bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.8)]",
  promotion: "bg-violet-300 shadow-[0_0_10px_rgba(192,132,252,0.8)]",
};

const TONE_PILL: Record<ActivityEventTone, string> = {
  live: "Live",
  win: "Win",
  info: "Info",
  champion: "Champion",
  promotion: "Promoted",
};

export default function GlobalActivityFeed({
  refreshMs = 30_000,
  limit = 8,
  seeMoreHref,
}: Props) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function load(initial: boolean) {
      if (!initial) setRefreshing(true);
      const next = await fetchPlatformActivity(supabase, limit);
      if (cancelled || !mountedRef.current) return;
      setEvents(next);
      if (!initial) setRefreshing(false);
    }

    void load(true);

    const interval = window.setInterval(() => void load(false), refreshMs);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [limit, refreshMs]);

  const isLoading = events === null;
  const items = events ?? [];

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/65 to-black p-4 shadow-xl sm:p-5"
      aria-label="Global live activity feed"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LivePulseBadge label="Live Activity" tone="cyan" size="md" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {refreshing ? "Refreshing…" : "Auto-updating"}
          </p>
        </div>
        {seeMoreHref ? (
          <a
            href={seeMoreHref}
            className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
          >
            See more →
          </a>
        ) : null}
      </div>

      {isLoading ? (
        <FeedSkeleton />
      ) : items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          Preparing live arena activity…
        </p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {items.map((event, index) => (
            <li
              key={event.id}
              className={`home-feed-item flex items-start gap-3 rounded-2xl border px-3 py-3 ${TONE_BORDER[event.tone]}`}
              style={{ animationDelay: `${Math.min(index * 50, 250)}ms` }}
            >
              <span
                className={`mt-1.5 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full ${TONE_DOT[event.tone]}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white sm:text-base">
                  {event.message}
                </p>
                {event.context ? (
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {event.context}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${TONE_BORDER[event.tone]}`}
                >
                  {TONE_PILL[event.tone]}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {event.relativeTime}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedSkeleton() {
  return (
    <ul
      className="mt-4 grid gap-2"
      aria-hidden
      data-testid="activity-feed-skeleton"
    >
      {Array.from({ length: 4 }).map((_, idx) => (
        <li
          key={idx}
          className="flex items-center gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-3"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-zinc-700" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800/80" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-zinc-800/60" />
          </div>
          <div className="h-3 w-10 animate-pulse rounded bg-zinc-800/80" />
        </li>
      ))}
    </ul>
  );
}
