"use client";

import Link from "next/link";
import {
  watchableRoundLabel,
  watchableStatusLabel,
  type WatchableMatch,
} from "../../lib/live/watch";
import SpectatorBadge from "./SpectatorBadge";

/**
 * Watch view header.
 *
 * Top-of-page chrome for `/watch/[roomCode]`. Surfaces tournament context,
 * round label, and the spectator status pill. Includes a single "Back"
 * link so spectators can return to the tournament page or home without
 * needing the browser back button.
 */
type Props = {
  match: WatchableMatch;
};

export default function WatchMatchHeader({ match }: Props) {
  const status = watchableStatusLabel(match);
  const roundLabel = watchableRoundLabel(match);
  const backHref = match.tournament
    ? `/tournaments/${match.tournament.id}`
    : "/";
  const backLabel = match.tournament ? "Back to tournament" : "Back home";

  const accentClass = match.tournament?.isFinal
    ? "border-yellow-300/55 bg-yellow-500/8 shadow-[0_0_28px_rgba(250,204,21,0.18)]"
    : status.tone === "live"
      ? "border-cyan-400/45 bg-cyan-500/8 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
      : "border-zinc-800 bg-zinc-950/70";

  return (
    <header
      className={`relative overflow-hidden rounded-3xl border px-4 py-4 sm:px-6 sm:py-5 ${accentClass}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SpectatorBadge statusLabel={status.label} tone={status.tone} />
            {match.tournament?.isFinal ? (
              <span className="rounded-full border border-yellow-300/55 bg-yellow-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-yellow-100 shadow-[0_0_14px_rgba(250,204,21,0.22)]">
                Final
              </span>
            ) : match.tournament?.isSemifinal ? (
              <span className="rounded-full border border-amber-400/45 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-amber-100">
                Semifinal
              </span>
            ) : null}
            <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-200">
              {roundLabel}
            </span>
          </div>

          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.32em] text-zinc-500">
            {match.tournament ? "Tournament" : "Casual room"}
          </p>
          <h1 className="mt-1 break-words text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">
            {match.tournament?.name ?? "Live match"}
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Room <span className="font-mono text-zinc-200">{match.roomCode}</span>
            <span aria-hidden className="px-1.5 text-zinc-600">
              ·
            </span>
            Read-only view
          </p>
        </div>

        <Link
          href={backHref}
          className="shrink-0 self-start rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs font-bold text-zinc-200 transition-colors hover:border-cyan-400/55 hover:text-cyan-100"
        >
          ← {backLabel}
        </Link>
      </div>
    </header>
  );
}
