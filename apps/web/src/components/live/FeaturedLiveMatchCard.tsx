"use client";

import Link from "next/link";
import type { FeaturedLiveMatch } from "../../lib/live/activity";
import LivePulseBadge from "./LivePulseBadge";

/**
 * Premium featured-match card.
 *
 * Used by the Home `FeaturedLiveMatches` strip and the tournament
 * `TournamentLiveSpotlight` panel. Carries gold treatment for finals,
 * cyan pulse for any live match, and a WATCH CTA linking to
 * `/watch/[roomCode]` (or disabled when no room code is available).
 */
type Props = {
  match: FeaturedLiveMatch;
  /** Visual emphasis level. "hero" gets bigger type for spotlight slots. */
  emphasis?: "hero" | "card";
};

export default function FeaturedLiveMatchCard({
  match,
  emphasis = "card",
}: Props) {
  const isFinal = match.isFinal;
  const isLive = match.status === "in_progress";
  const isHero = emphasis === "hero";

  const accentClass = isFinal
    ? "border-yellow-300/55 bg-yellow-500/8 shadow-[0_0_28px_rgba(250,204,21,0.22)]"
    : match.isSemifinal && isLive
      ? "border-amber-400/50 bg-amber-500/8 shadow-[0_0_22px_rgba(245,158,11,0.18)]"
      : isLive
        ? "border-cyan-400/45 bg-cyan-500/5 shadow-[0_0_22px_rgba(34,211,238,0.18)]"
        : "border-zinc-800/80 bg-zinc-950/65";

  const titleClass = isHero
    ? "text-lg font-black sm:text-xl md:text-2xl"
    : "text-base font-black sm:text-lg";

  const tournamentNameClass = isHero
    ? "text-xs font-black uppercase tracking-[0.28em]"
    : "text-[10px] font-black uppercase tracking-[0.24em]";

  const watchHref = match.roomCode
    ? `/watch/${match.roomCode.toUpperCase()}`
    : null;

  return (
    <article
      className={`flex h-full flex-col gap-3 rounded-3xl border px-4 py-4 sm:px-5 sm:py-5 ${accentClass}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`truncate ${tournamentNameClass} text-zinc-300`}>
          {match.tournamentName}
        </span>
        {isFinal ? (
          <LivePulseBadge
            label={isLive ? "Final · LIVE" : "Final"}
            tone="amber"
            pulsing={isLive}
            size={isHero ? "md" : "sm"}
          />
        ) : isLive ? (
          <LivePulseBadge
            label={match.isSemifinal ? "Semifinal · LIVE" : "Live"}
            tone="cyan"
            size={isHero ? "md" : "sm"}
          />
        ) : (
          <LivePulseBadge
            label={match.roundLabel}
            tone="neutral"
            pulsing={false}
            size={isHero ? "md" : "sm"}
          />
        )}
      </div>

      <div className="flex flex-1 items-center justify-between gap-3">
        <span className={`min-w-0 flex-1 truncate ${titleClass} text-white`}>
          {match.playerOne}
        </span>
        <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          vs
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-right ${titleClass} text-white`}
        >
          {match.playerTwo}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {match.reason}
        </span>
        {watchHref ? (
          <Link
            href={watchHref}
            className={`rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
              isFinal
                ? "border-yellow-300/55 bg-yellow-500/10 text-yellow-100 hover:bg-yellow-500/20"
                : "border-cyan-500/45 bg-cyan-500/8 text-cyan-100 hover:bg-cyan-500/15"
            }`}
            aria-label={`Watch ${match.playerOne} versus ${match.playerTwo}`}
          >
            ▶ Watch
          </Link>
        ) : (
          <span
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
            title="Waiting for room assignment"
          >
            Soon
          </span>
        )}
      </div>
    </article>
  );
}
