"use client";

import type { ReactNode } from "react";

export type TournamentHubStats = {
  live: number;
  upcoming: number;
  mine: number;
  completed: number;
};

type TournamentHubHeroProps = {
  stats: TournamentHubStats;
  /** Optional explicit loading state — replaces values with a soft dash so the
   * hero never flashes "0" before the first fetch resolves. */
  isLoading?: boolean;
  /** Optional trailing action node (e.g. "Refresh" button). */
  rightSlot?: ReactNode;
};

type Stat = {
  label: string;
  value: number;
  hint: string;
  tone: "cyan" | "amber" | "violet" | "gold";
  ariaLabel: string;
};

const TONE_CLASS: Record<Stat["tone"], { ring: string; glow: string; text: string; dot: string }> = {
  cyan: {
    ring: "ring-cyan-400/40",
    glow: "shadow-[0_0_22px_rgba(34,211,238,0.18)]",
    text: "text-cyan-100",
    dot: "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]",
  },
  amber: {
    ring: "ring-amber-400/40",
    glow: "shadow-[0_0_22px_rgba(251,191,36,0.18)]",
    text: "text-amber-100",
    dot: "bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.8)]",
  },
  violet: {
    ring: "ring-violet-400/40",
    glow: "shadow-[0_0_22px_rgba(167,139,250,0.18)]",
    text: "text-violet-100",
    dot: "bg-violet-300 shadow-[0_0_8px_rgba(167,139,250,0.7)]",
  },
  gold: {
    ring: "ring-yellow-300/45",
    glow: "shadow-[0_0_22px_rgba(234,179,8,0.22)]",
    text: "text-yellow-100",
    dot: "bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.8)]",
  },
};

export default function TournamentHubHero({
  stats,
  isLoading = false,
  rightSlot,
}: TournamentHubHeroProps) {
  const cards: Stat[] = [
    {
      label: "Live events",
      value: stats.live,
      hint: stats.live > 0 ? "Brackets in progress" : "Next arena coming up",
      tone: "cyan",
      ariaLabel: "Live events",
    },
    {
      label: "Starting soon",
      value: stats.upcoming,
      hint:
        stats.upcoming > 0
          ? "Registration open"
          : "Lobby is quiet — host one",
      tone: "amber",
      ariaLabel: "Starting soon",
    },
    {
      label: "Your tournaments",
      value: stats.mine,
      hint:
        stats.mine > 0
          ? "You are registered or hosting"
          : "Join one to climb the arena",
      tone: "violet",
      ariaLabel: "Your tournaments",
    },
    {
      label: "Completed",
      value: stats.completed,
      hint:
        stats.completed > 0 ? "Past champions on record" : "First champion incoming",
      tone: "gold",
      ariaLabel: "Completed events",
    },
  ];

  return (
    <section
      className="relative overflow-hidden rounded-3xl border-2 border-zinc-800/80 bg-gradient-to-br from-zinc-950 via-zinc-950 to-black px-4 py-6 shadow-2xl sm:px-6 sm:py-7"
      aria-label="Tournaments overview"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.32em] text-amber-200">
            🏆 Event Hub
          </p>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">
            <span className="bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              Tournaments
            </span>
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-zinc-400 sm:text-base">
            Compete in live knockout events and climb the arena.
          </p>
        </div>
        {rightSlot ? (
          <div className="shrink-0 self-stretch sm:self-auto">{rightSlot}</div>
        ) : null}
      </div>

      <dl className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {cards.map((card) => {
          const tone = TONE_CLASS[card.tone];
          return (
            <div
              key={card.label}
              aria-label={card.ariaLabel}
              className={`rounded-2xl border border-zinc-800 bg-zinc-950/65 px-3 py-3 ring-1 ${tone.ring} ${tone.glow}`}
            >
              <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`}
                  aria-hidden
                />
                {card.label}
              </dt>
              <dd
                className={`mt-1 text-xl font-black leading-none tabular-nums sm:text-2xl ${tone.text}`}
              >
                {isLoading ? "—" : card.value.toLocaleString()}
              </dd>
              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {card.hint}
              </p>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
