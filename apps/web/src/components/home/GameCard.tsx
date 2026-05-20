"use client";

import Link from "next/link";

export type GameCardStatus = "live" | "soon" | "preparing";

export type GameCardData = {
  id: string;
  title: string;
  /** Short subtitle / genre line. */
  subtitle: string;
  /** Approximate online count for display. */
  playersOnline: number;
  status: GameCardStatus;
  /** Highlights the card with extra glow. */
  featured?: boolean;
  /** Route to navigate to when tapped. */
  href: string;
  /** Inline icon — emoji is fine. */
  icon: string;
  /** Optional disabled flag (mock games we haven't shipped). */
  comingSoon?: boolean;
};

const STATUS_LABEL: Record<GameCardStatus, string> = {
  live: "Live now",
  soon: "Waiting for challengers",
  preparing: "Preparing arena…",
};

const STATUS_CLASS: Record<GameCardStatus, string> = {
  live: "border-cyan-400/55 bg-cyan-500/15 text-cyan-100",
  soon: "border-amber-400/45 bg-amber-500/10 text-amber-100",
  preparing: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
};

const STATUS_DOT: Record<GameCardStatus, string> = {
  live: "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]",
  soon: "bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.7)]",
  preparing: "bg-zinc-400",
};

type Props = { game: GameCardData };

export default function GameCard({ game }: Props) {
  const card = (
    <div
      className={`group relative h-full w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl border bg-gradient-to-br from-zinc-950 via-zinc-950/65 to-black p-4 transition-transform sm:w-[62%] md:w-[300px] ${
        game.featured
          ? "border-cyan-500/55 shadow-[0_0_28px_rgba(34,211,238,0.25)] hover:scale-[1.02]"
          : "border-zinc-800 hover:scale-[1.015] hover:border-zinc-600"
      } ${game.comingSoon ? "opacity-95" : ""}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-10 h-28 w-28 rounded-full opacity-25 blur-2xl transition-opacity group-hover:opacity-50"
        style={{
          background: game.featured
            ? "radial-gradient(circle, rgba(34,211,238,0.55), transparent 70%)"
            : "radial-gradient(circle, rgba(124,58,237,0.4), transparent 70%)",
        }}
      />

      <div className="relative flex items-start justify-between gap-2">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/35 text-2xl"
          aria-hidden
        >
          {game.icon}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] ${STATUS_CLASS[game.status]}`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 animate-pulse rounded-full ${STATUS_DOT[game.status]}`}
            aria-hidden
          />
          {STATUS_LABEL[game.status]}
        </span>
      </div>

      <p className="mt-3 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
        {game.subtitle}
      </p>
      <h3 className="mt-1 truncate text-lg font-black tracking-tight text-white sm:text-xl">
        {game.title}
      </h3>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Online
          </p>
          <p className="text-base font-black tabular-nums text-white">
            {game.playersOnline.toLocaleString()}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider ${
            game.comingSoon
              ? "border border-zinc-700 bg-zinc-900/80 text-zinc-400"
              : game.featured
                ? "bg-gradient-to-r from-cyan-400 to-amber-500 text-zinc-950"
                : "bg-zinc-800 text-white"
          }`}
        >
          {game.comingSoon ? "Soon" : "Play"}
          {!game.comingSoon ? <span aria-hidden>→</span> : null}
        </span>
      </div>
    </div>
  );

  if (game.comingSoon) {
    return (
      <div aria-disabled className="block">
        {card}
      </div>
    );
  }

  return (
    <Link href={game.href} aria-label={`Open ${game.title}`} className="block">
      {card}
    </Link>
  );
}
