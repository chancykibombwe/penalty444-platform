"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "../../lib/supabase/client";
import {
  fetchFeaturedPlayers,
  type FeaturedPlayer,
} from "../../lib/social/featured";
import { useVisibleInterval } from "../../lib/polling/useVisibleInterval";
import LivePulseBadge from "../live/LivePulseBadge";
import RankBadge from "../player/RankBadge";
import ExpandToggle from "../ui/ExpandToggle";
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

  useVisibleInterval(
    async (signal) => {
      const next = await fetchFeaturedPlayers(supabase, limit);
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
        <p className="mt-6 rounded-2xl border border-dashed border-[#1B2433] bg-black/35 px-4 py-6 text-center text-sm font-semibold text-zinc-400">
          Rising competitors are warming up…
        </p>
      ) : (
        <div className="mt-3">
          <div className="grid gap-3">
            <PlayerTile
              key={`${list[0].userId}:${list[0].reason}`}
              player={list[0]}
            />
          </div>
          {list.length > 1 ? (
            <ExpandToggle
              label={`+${list.length - 1} more player${list.length - 1 === 1 ? "" : "s"}`}
              expandedLabel="Show less"
            >
              <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:gap-4">
                {list.slice(1).map((player) => (
                  <PlayerTile key={`${player.userId}:${player.reason}`} player={player} />
                ))}
              </div>
            </ExpandToggle>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PlayerTile({ player }: { player: FeaturedPlayer }) {
  const accent = REASON_TONE[player.reason];

  return (
    <article
      className={`flex flex-col gap-2.5 rounded-2xl border px-3.5 py-3 ${accent}`}
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
        <p className="truncate text-lg font-black tracking-tight text-white transition-colors hover:text-cyan-100 sm:text-xl">
          {player.username}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-400">
          {player.reasonLabel}
        </p>
      </Link>

      <dl className="grid grid-cols-3 gap-2 border-t border-zinc-800/60 pt-2.5">
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
          className="h-44 animate-pulse rounded-2xl border border-[#1B2433] bg-[#0D1420]/65"
        />
      ))}
    </div>
  );
}
