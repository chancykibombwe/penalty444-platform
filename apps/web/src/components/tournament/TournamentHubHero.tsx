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
    ring: "ring-[#3B9EFF]/40",
    glow: "shadow-[0_0_22px_rgba(59,158,255,0.18)]",
    text: "text-[#9CCBFF]",
    dot: "bg-[#3B9EFF] shadow-[0_0_8px_rgba(59,158,255,0.8)]",
  },
  amber: {
    ring: "ring-[#E0A000]/40",
    glow: "shadow-[0_0_22px_rgba(224,160,0,0.18)]",
    text: "text-[#F5C453]",
    dot: "bg-[#E0A000] shadow-[0_0_8px_rgba(224,160,0,0.8)]",
  },
  violet: {
    ring: "ring-[#8B5CF6]/40",
    glow: "shadow-[0_0_22px_rgba(139,92,246,0.18)]",
    text: "text-[#C4B5FD]",
    dot: "bg-[#8B5CF6] shadow-[0_0_8px_rgba(139,92,246,0.7)]",
  },
  gold: {
    ring: "ring-[#22C55E]/40",
    glow: "shadow-[0_0_22px_rgba(34,197,94,0.18)]",
    text: "text-[#86EFAC]",
    dot: "bg-[#22C55E] shadow-[0_0_8px_rgba(34,197,94,0.8)]",
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
      className="relative overflow-hidden rounded-3xl border-2 border-[#1B2433] bg-gradient-to-br from-[#0A0E14] via-[#0A0E14] to-black px-4 py-4 shadow-2xl sm:px-5 sm:py-5"
      aria-label="Tournaments overview"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-[#3B9EFF]/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-[#8B5CF6]/10 blur-3xl"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#E0A000]/40 bg-[#E0A000]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.32em] text-[#F5C453]">
            🏆 Event Hub
          </p>
          <h1 className="mt-2 text-xl font-black tracking-tight text-white sm:text-2xl md:text-3xl">
            <span className="bg-gradient-to-r from-[#9CCBFF] via-white to-[#C4B5FD] bg-clip-text text-transparent">
              Tournaments
            </span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-400 sm:text-base">
            Join or host free knockout tournaments. Stats below reflect live data.
          </p>
        </div>
        {rightSlot ? (
          <div className="shrink-0 self-stretch sm:self-auto">{rightSlot}</div>
        ) : null}
      </div>

      <dl className="relative mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {cards.map((card) => {
          const tone = TONE_CLASS[card.tone];
          return (
            <div
              key={card.label}
              aria-label={card.ariaLabel}
              className={`rounded-2xl border border-[#1B2433] bg-[#0D1420] px-2.5 py-2.5 ring-1 ${tone.ring} ${tone.glow}`}
            >
              <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`}
                  aria-hidden
                />
                {card.label}
              </dt>
              <dd
                className={`mt-1 text-lg font-black leading-none tabular-nums sm:text-xl ${tone.text}`}
              >
                {isLoading ? "—" : card.value.toLocaleString()}
              </dd>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {card.hint}
              </p>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
