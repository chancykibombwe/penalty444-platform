"use client";

import type { ReactNode } from "react";

export type PlayerStatsData = {
  wins: number;
  winRatePct: number;
  /** Current streak (positive). */
  streak: number;
  /** Display label for the rank (e.g. "Bronze IV", "Unranked"). */
  rankLabel: string;
};

const PLACEHOLDER_STATS: PlayerStatsData = {
  wins: 0,
  winRatePct: 0,
  streak: 0,
  rankLabel: "Unranked",
};

type Props = {
  stats?: PlayerStatsData;
  /** Optional sub-heading line shown above the stat grid. */
  username?: string | null;
};

type Stat = {
  label: string;
  value: ReactNode;
  hint: string;
  tone: "cyan" | "amber" | "violet" | "gold";
};

const TONE_CLASS: Record<Stat["tone"], { ring: string; glow: string; text: string }> = {
  cyan: {
    ring: "ring-cyan-400/35",
    glow: "shadow-[0_0_22px_rgba(34,211,238,0.15)]",
    text: "text-cyan-100",
  },
  amber: {
    ring: "ring-amber-400/35",
    glow: "shadow-[0_0_22px_rgba(251,191,36,0.16)]",
    text: "text-amber-100",
  },
  violet: {
    ring: "ring-violet-400/35",
    glow: "shadow-[0_0_22px_rgba(167,139,250,0.16)]",
    text: "text-violet-100",
  },
  gold: {
    ring: "ring-yellow-300/45",
    glow: "shadow-[0_0_22px_rgba(234,179,8,0.2)]",
    text: "text-yellow-100",
  },
};

export default function PlayerStatsStrip({
  stats = PLACEHOLDER_STATS,
  username = null,
}: Props) {
  const cards: Stat[] = [
    {
      label: "Wins",
      value: stats.wins.toLocaleString(),
      hint: "Career victories",
      tone: "cyan",
    },
    {
      label: "Win Rate",
      value: `${Math.round(stats.winRatePct)}%`,
      hint: "Last 30 days",
      tone: "violet",
    },
    {
      label: "Streak",
      value: stats.streak > 0 ? `${stats.streak}` : "—",
      hint: stats.streak > 0 ? "On fire" : "Stay sharp",
      tone: "amber",
    },
    {
      label: "Rank",
      value: stats.rankLabel,
      hint: stats.rankLabel === "Unranked" ? "Play 5 to qualify" : "Climbing",
      tone: "gold",
    },
  ];

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/60 to-black p-4 shadow-xl sm:p-5"
      aria-label="Your statistics"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
            Your Performance
          </p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-white sm:text-xl">
            {username ? `Welcome back, ${username}` : "Welcome to the arena"}
          </h2>
        </div>
        <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-300">
          All games
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {cards.map((card) => {
          const tone = TONE_CLASS[card.tone];
          return (
            <div
              key={card.label}
              className={`rounded-2xl border border-zinc-800 bg-zinc-950/65 px-3 py-3 ring-1 ${tone.ring} ${tone.glow}`}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                {card.label}
              </p>
              <p className={`mt-1 text-xl font-black leading-none tabular-nums sm:text-2xl ${tone.text}`}>
                {card.value}
              </p>
              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {card.hint}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
