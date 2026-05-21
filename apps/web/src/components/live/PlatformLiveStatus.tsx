"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  EMPTY_COUNTS,
  fetchPlatformLiveCounts,
  type PlatformLiveCounts,
} from "../../lib/live/activity";
import LivePulseBadge from "./LivePulseBadge";

/**
 * Platform Live Status (Phase 7).
 *
 * Compact strip showing arena-wide energy: live matches, live tournaments,
 * placement players, ranked players, and active events. Data is pulled
 * read-only from existing tables. Polls every `refreshMs` to feel alive.
 */
type Props = {
  refreshMs?: number;
};

type Tile = {
  key: keyof PlatformLiveCounts;
  label: string;
  hint: string;
  tone: "cyan" | "amber" | "violet" | "emerald" | "neutral";
  pulse: boolean;
};

const TILES: Tile[] = [
  {
    key: "liveMatches",
    label: "Live Matches",
    hint: "Right now",
    tone: "cyan",
    pulse: true,
  },
  {
    key: "liveTournaments",
    label: "Live Tournaments",
    hint: "In progress",
    tone: "amber",
    pulse: true,
  },
  {
    key: "activeEvents",
    label: "Active Events",
    hint: "Registration + live",
    tone: "violet",
    pulse: false,
  },
  {
    key: "rankedPlayers",
    label: "Ranked Players",
    hint: "10+ matches",
    tone: "emerald",
    pulse: false,
  },
  {
    key: "placementPlayers",
    label: "In Placement",
    hint: "Under 10 matches",
    tone: "neutral",
    pulse: false,
  },
];

const TONE_BG: Record<Tile["tone"], string> = {
  cyan: "border-cyan-400/45 bg-cyan-500/10",
  amber: "border-yellow-300/55 bg-yellow-500/10",
  violet: "border-violet-400/45 bg-violet-500/10",
  emerald: "border-emerald-400/45 bg-emerald-500/10",
  neutral: "border-zinc-700/80 bg-zinc-900/70",
};

const TONE_LABEL: Record<Tile["tone"], string> = {
  cyan: "text-cyan-200",
  amber: "text-yellow-200",
  violet: "text-violet-200",
  emerald: "text-emerald-200",
  neutral: "text-zinc-300",
};

const TONE_VALUE: Record<Tile["tone"], string> = {
  cyan: "text-white",
  amber: "text-white",
  violet: "text-white",
  emerald: "text-white",
  neutral: "text-zinc-100",
};

export default function PlatformLiveStatus({ refreshMs = 30_000 }: Props) {
  const [counts, setCounts] = useState<PlatformLiveCounts | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function load() {
      const next = await fetchPlatformLiveCounts(supabase);
      if (cancelled || !mountedRef.current) return;
      setCounts(next);
    }

    void load();
    const interval = window.setInterval(load, refreshMs);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [refreshMs]);

  const data = counts ?? EMPTY_COUNTS;
  const isLoading = counts === null;
  const totalActive =
    data.liveMatches + data.liveTournaments + data.activeEvents;

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black p-4 shadow-xl sm:p-5"
      aria-label="Platform live status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LivePulseBadge
            label="Arena Live"
            tone={totalActive > 0 ? "cyan" : "neutral"}
            size="md"
            pulsing={totalActive > 0}
          />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Platform snapshot
          </p>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {isLoading ? "Loading…" : "Updated just now"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {TILES.map((tile) => {
          const value = data[tile.key];
          const showPulse = tile.pulse && value > 0;
          return (
            <div
              key={tile.key}
              className={`relative overflow-hidden rounded-2xl border px-3 py-2.5 ${TONE_BG[tile.tone]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] font-black uppercase tracking-[0.22em] ${TONE_LABEL[tile.tone]}`}
                >
                  {tile.label}
                </span>
                {showPulse ? (
                  <span
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-80"
                    aria-hidden
                  />
                ) : null}
              </div>
              <div
                className={`mt-1 text-2xl font-black tabular-nums ${TONE_VALUE[tile.tone]}`}
              >
                {isLoading ? "…" : value.toLocaleString()}
              </div>
              <p className="mt-0.5 text-[10px] font-semibold text-zinc-500">
                {tile.hint}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
