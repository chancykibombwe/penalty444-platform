"use client";

import Link from "next/link";
import HexIconFrame from "../ui/HexIconFrame";

export type GameCardStatus = "live" | "coming-soon";

export type GameCardData = {
  id: string;
  title: string;
  /** Short subtitle / genre line. */
  subtitle: string;
  status: GameCardStatus;
  /** Highlights the card with extra glow. */
  featured?: boolean;
  /** Route to navigate to when tapped. */
  href: string;
  /** Inline icon — emoji is fine. */
  icon: string;
  /** Optional disabled flag (games we haven't shipped). */
  comingSoon?: boolean;
};

const STATUS_LABEL: Record<GameCardStatus, string> = {
  live: "Free Play",
  "coming-soon": "Coming Soon",
};

const STATUS_CLASS: Record<GameCardStatus, string> = {
  live: "border-[#3B9EFF]/55 bg-[#3B9EFF]/15 text-[#9AD2FF]",
  "coming-soon": "border-zinc-700 bg-zinc-800/60 text-zinc-300",
};

const STATUS_DOT: Record<GameCardStatus, string> = {
  live: "bg-[#3B9EFF] shadow-[0_0_8px_rgba(59,158,255,0.8)]",
  "coming-soon": "bg-zinc-400",
};

type Props = { game: GameCardData };

export default function GameCard({ game }: Props) {
  const card = (
    <div
      className={`group relative h-full w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl border bg-gradient-to-br from-zinc-950 via-zinc-950/65 to-black p-3 transition-transform sm:w-[62%] md:w-[300px] ${
        game.featured
          ? "border-[#3B9EFF]/55 shadow-[0_0_28px_rgba(59,158,255,0.25)] hover:scale-[1.02]"
          : "border-[#1B2433] hover:scale-[1.015] hover:border-zinc-600"
      } ${game.comingSoon ? "opacity-95" : ""}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-10 h-28 w-28 rounded-full opacity-25 blur-2xl transition-opacity group-hover:opacity-50"
        style={{
          background: game.featured
            ? "radial-gradient(circle, rgba(59,158,255,0.55), transparent 70%)"
            : "radial-gradient(circle, rgba(139,92,246,0.4), transparent 70%)",
        }}
      />

      <div className="relative flex items-start justify-between gap-2">
        <HexIconFrame tone={game.featured ? "primary" : "muted"} size="md">
          {game.icon}
        </HexIconFrame>
        <div className="flex flex-col items-end gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] ${STATUS_CLASS[game.status]}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${game.comingSoon ? "" : "animate-pulse"} ${STATUS_DOT[game.status]}`}
              aria-hidden
            />
            {STATUS_LABEL[game.status]}
          </span>
          <span className="inline-flex items-center rounded-full border border-[#1B2433] bg-[#111827]/80 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
            1v1
          </span>
        </div>
      </div>

      <p className="mt-2.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
        {game.subtitle}
      </p>
      <h3 className="mt-1 truncate text-base font-black tracking-tight text-white sm:text-lg">
        {game.title}
      </h3>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider ${
            game.comingSoon
              ? "border border-[#1B2433] bg-[#111827]/80 text-zinc-400"
              : game.featured
                ? "bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0] text-white"
                : "bg-zinc-800 text-white"
          }`}
        >
          {game.comingSoon ? "Coming Soon" : "Play"}
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
