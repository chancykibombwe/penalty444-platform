"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase/client";
import {
  resolvePlayerTier,
  UNRANKED_MATCHES_THRESHOLD,
} from "../../lib/player/ranks";

type BarState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "placement"; username: string; matchesPlayed: number }
  | {
      status: "ranked";
      rank: number;
      username: string;
      rankPoints: number;
      winRate: number;
      matches: number;
    };

function initials(username: string) {
  return (
    username
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export default function YourRankBar() {
  const [bar, setBar] = useState<BarState>({ status: "loading" });

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setBar({ status: "hidden" });
          return;
        }

        const { data: stats } = await supabase
          .from("player_stats")
          .select("matches, wins, losses, rank_points, username")
          .eq("user_id", session.user.id)
          .eq("game_id", "penalty444")
          .maybeSingle();

        if (!stats) {
          setBar({ status: "hidden" });
          return;
        }

        if (stats.matches < UNRANKED_MATCHES_THRESHOLD) {
          setBar({
            status: "placement",
            username: stats.username ?? "Player",
            matchesPlayed: stats.matches,
          });
          return;
        }

        // Count players ranked strictly above the current user by rank_points
        const { count } = await supabase
          .from("player_stats")
          .select("user_id", { count: "exact", head: true })
          .eq("game_id", "penalty444")
          .gte("matches", UNRANKED_MATCHES_THRESHOLD)
          .gt("rank_points", stats.rank_points);

        setBar({
          status: "ranked",
          rank: (count ?? 0) + 1,
          username: stats.username ?? "Player",
          rankPoints: stats.rank_points,
          winRate:
            stats.matches > 0
              ? Math.round((stats.wins / stats.matches) * 100)
              : 0,
          matches: stats.matches,
        });
      } catch {
        setBar({ status: "hidden" });
      }
    }
    load();
  }, []);

  if (bar.status === "hidden") return null;

  const wrap =
    "fixed bottom-[68px] left-0 right-0 z-30 px-3 sm:bottom-4 sm:px-4 md:bottom-5 md:px-6";

  if (bar.status === "loading") {
    return (
      <div className={wrap}>
        <div className="mx-auto max-w-[560px]">
          <div className="h-[60px] animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/90 backdrop-blur-sm" />
        </div>
      </div>
    );
  }

  if (bar.status === "placement") {
    return (
      <div className={wrap}>
        <div className="mx-auto max-w-[560px]">
          <div className="flex h-[60px] items-center justify-between gap-3 rounded-2xl border border-zinc-700/60 bg-zinc-950/98 px-4 shadow-[0_-4px_24px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/80 text-[11px] font-black text-zinc-300">
                {initials(bar.username)}
              </div>
              <div>
                <p className="text-[8px] font-black uppercase tracking-[0.28em] text-zinc-500">
                  YOUR RANK
                </p>
                <p className="text-sm font-bold text-zinc-200">
                  {bar.username}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-500">
                Placement
              </p>
              <p className="text-xs font-bold tabular-nums text-zinc-400">
                {bar.matchesPlayed}/{UNRANKED_MATCHES_THRESHOLD} played
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ranked state
  const tier = resolvePlayerTier({
    rating: bar.rankPoints,
    matchesPlayed: bar.matches,
  });

  return (
    <div className={wrap}>
      <div className="mx-auto max-w-[560px]">
        <div
          className="flex h-[60px] items-center gap-3 rounded-2xl border border-cyan-400/55 bg-zinc-950/98 px-4 backdrop-blur-md"
          style={{
            boxShadow:
              "0 0 0 1px rgba(34,211,238,0.12), 0 -4px_32px rgba(0,0,0,0.70), 0 0 28px rgba(34,211,238,0.18), inset 0 1px 0 rgba(34,211,238,0.08)",
          }}
        >
          {/* YOUR RANK + number */}
          <div className="shrink-0">
            <p className="text-[8px] font-black uppercase tracking-[0.30em] text-cyan-400">
              YOUR RANK
            </p>
            <p className="text-[22px] font-black tabular-nums leading-none text-white">
              #{bar.rank}
            </p>
          </div>

          {/* Vertical divider */}
          <div className="h-9 w-px shrink-0 bg-zinc-800" />

          {/* Avatar with cyan ring */}
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-cyan-800/50 to-zinc-900 text-[11px] font-black text-white"
            style={{
              boxShadow:
                "0 0 0 2px rgba(34,211,238,0.55), 0 0 0 4px rgba(34,211,238,0.18), 0 0 16px rgba(34,211,238,0.22)",
            }}
          >
            {initials(bar.username)}
          </div>

          {/* Name + tier */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-white">
              {bar.username}
            </p>
            <div
              className={`flex items-center gap-1 text-[10px] font-bold ${tier.textClass}`}
            >
              <span>{tier.icon}</span>
              <span>{tier.label}</span>
            </div>
          </div>

          {/* Points + win rate */}
          <div className="shrink-0 text-right">
            <p className="text-base font-black tabular-nums text-yellow-200">
              {bar.rankPoints}
            </p>
            <p className="text-[10px] font-bold text-zinc-500">
              {bar.winRate}%
            </p>
          </div>

          {/* Chevron */}
          <svg
            className="h-4 w-4 shrink-0 text-zinc-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </div>
    </div>
  );
}
