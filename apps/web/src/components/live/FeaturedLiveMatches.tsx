"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchFeaturedLiveMatches,
  type FeaturedLiveMatch,
} from "../../lib/live/activity";
import { supabase } from "../../lib/supabase/client";
import FeaturedLiveMatchCard from "./FeaturedLiveMatchCard";
import LivePulseBadge from "./LivePulseBadge";

/**
 * Featured Live Matches — premium spotlight strip for the Home page.
 *
 * Pulls from `fetchFeaturedLiveMatches`, which already prioritizes:
 *   1. Tournament finals
 *   2. Tournament semifinals
 *   3. Tournament in_progress
 *   4. Tournament ready
 *   5. Recent competitive matches (fallback)
 *
 * Auto-refreshes every `refreshMs` (default 30s) to mirror the rest of
 * the Phase 7 live ecosystem.
 */
type Props = {
  refreshMs?: number;
  limit?: number;
};

export default function FeaturedLiveMatches({
  refreshMs = 30_000,
  limit = 4,
}: Props) {
  const [items, setItems] = useState<FeaturedLiveMatch[] | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function load() {
      const next = await fetchFeaturedLiveMatches(supabase, limit);
      if (cancelled || !mountedRef.current) return;
      setItems(next);
    }

    void load();
    const interval = window.setInterval(load, refreshMs);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [refreshMs, limit]);

  const isLoading = items === null;
  const list = items ?? [];
  const hero = list.find((item) => item.priority === 1) ?? null;
  const rest = hero ? list.filter((item) => item !== hero) : list;
  const anyLive = list.some((item) => item.status === "in_progress");

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/65 to-black p-4 shadow-xl sm:p-5"
      aria-label="Featured live matches"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LivePulseBadge
            label="Featured Arenas"
            tone={anyLive ? "cyan" : "neutral"}
            pulsing={anyLive}
            size="md"
          />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Watch the action
          </p>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          Auto-updating
        </p>
      </div>

      {isLoading ? (
        <FeaturedSkeleton />
      ) : list.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          Preparing featured arenas…
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:gap-4">
          {hero ? (
            <FeaturedLiveMatchCard match={hero} emphasis="hero" />
          ) : null}
          {rest.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              {rest.map((item) => (
                <FeaturedLiveMatchCard key={item.id} match={item} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="mt-4 grid gap-3 sm:gap-4" aria-hidden>
      <div className="h-32 animate-pulse rounded-3xl border border-zinc-800/80 bg-zinc-950/65" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-3xl border border-zinc-800/80 bg-zinc-950/65" />
        <div className="h-28 animate-pulse rounded-3xl border border-zinc-800/80 bg-zinc-950/65" />
      </div>
    </div>
  );
}
