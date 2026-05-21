"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  fetchFeaturedPlayers,
  type FeaturedPlayer,
} from "../../lib/social/featured";
import LivePulseBadge from "../live/LivePulseBadge";
import RankBadge from "../player/RankBadge";
import { ViewProfileButton, ChallengePlayerButton } from "./SocialActions";

/**
 * FeaturedPlayers — home strip surfacing top ranked players, recent
 * tournament champions, and high-volume competitors. All data comes
 * from existing `player_stats` and `tournaments` (read-only).
 *
 * Empty state copy: "Rising competitors are warming up..." per Phase 9.
 */
type Props = {
  refreshMs?: number;
  limit?: number;
};

const REASON_TONE: Record<FeaturedPlayer["reason"], string> = {
  "top-ranked": "border-cyan-400/45 bg-cyan-500/8",
  "longest-streak": "border-emerald-400/45 bg-emerald-500/8",
  champion: "border-yellow-300/55 bg-yellow-500/8",
};

const REASON_LABEL: Record<FeaturedPlayer["reason"], string> = {
  "top-ranked": "Top Ranked",
  "longest-streak": "Most Wins",
  champion: "Champion",
};

export default function FeaturedPlayers({
  refreshMs = 60_000,
  limit = 4,
}: Props) {
  const [items, setItems] = useState<FeaturedPlayer[] | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function load() {
      const next = await fetchFeaturedPlayers(supabase, limit);
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

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/65 to-black p-4 shadow-xl sm:p-5"
      aria-label="Featured competitors"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LivePulseBadge
            label="Featured Players"
            tone="amber"
            pulsing={false}
            size="md"
          />
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Ranked · Champions · Competitors
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
        <FeaturedSkeleton />
      ) : list.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-zinc-800 bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          Rising competitors are warming up…
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {list.map((player) => (
            <PlayerTile key={`${player.userId}:${player.reason}`} player={player} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerTile({ player }: { player: FeaturedPlayer }) {
  const accent = REASON_TONE[player.reason];

  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 ${accent}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300">
          {REASON_LABEL[player.reason]}
        </span>
        <RankBadge
          rating={player.rating}
          matchesPlayed={player.matchesPlayed}
          showRating
          variant="chip"
        />
      </div>

      <Link
        href={`/profile/${encodeURIComponent(player.username)}`}
        className="block min-w-0"
      >
        <p className="truncate text-xl font-black tracking-tight text-white transition-colors hover:text-cyan-100 sm:text-2xl">
          {player.username}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-400">
          {player.reasonLabel}
        </p>
      </Link>

      <dl className="grid grid-cols-3 gap-2 border-t border-zinc-800/60 pt-3">
        <Stat label="Wins" value={player.wins} />
        <Stat
          label="Win Rate"
          value={player.matchesPlayed >= 10 ? `${player.winRate}%` : "—"}
        />
        <Stat label="Matches" value={player.matchesPlayed} />
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <ViewProfileButton username={player.username} />
        <ChallengePlayerButton username={player.username} />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[9px] font-black uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-black tabular-nums text-white">
        {value}
      </dd>
    </div>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={idx}
          className="h-44 animate-pulse rounded-2xl border border-zinc-800/80 bg-zinc-950/65"
        />
      ))}
    </div>
  );
}
