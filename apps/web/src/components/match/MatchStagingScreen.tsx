"use client";

import type { PresentationAccent } from "./matchPresentation";

/**
 * Pre-match cinematic staging overlay.
 *
 * Display-only: parent controls the countdown value and visibility. Tournament
 * matches use this for the 5-second pre-shootout cinematic. Reusable for
 * future ranked / spectator intros.
 *
 * Props:
 *   - visible: whether the overlay should render
 *   - title: round label (e.g. "Quarter Final", "Round 2")
 *   - tournamentName: optional tournament name shown above the title
 *   - leftName / rightName: player names for the VS card
 *   - seconds: current countdown second; show "GO" or hide when 0
 *   - accent: "cyan" | "gold" | "gold-final"
 *
 * Does NOT block input — gameplay still resolves underneath if a stray pick
 * arrives. Parent is responsible for tearing it down after the count hits 0.
 */
export default function MatchStagingScreen({
  visible,
  title,
  tournamentName,
  leftName,
  rightName,
  seconds,
  accent = "cyan",
}: {
  visible: boolean;
  title: string;
  tournamentName?: string | null;
  leftName: string;
  rightName: string;
  seconds: number | null;
  accent?: PresentationAccent;
}) {
  if (!visible) return null;

  const isFinal = accent === "gold-final";
  const isGold = accent === "gold" || isFinal;

  const cardClass = isFinal
    ? "border-yellow-300/70 bg-gradient-to-br from-yellow-950/75 via-amber-950/65 to-black shadow-[0_0_64px_rgba(234,179,8,0.36)]"
    : isGold
      ? "border-amber-500/60 bg-gradient-to-br from-amber-950/55 via-zinc-950 to-black shadow-[0_0_48px_rgba(251,191,36,0.22)]"
      : "border-cyan-400/55 bg-gradient-to-br from-sky-950/55 via-zinc-950 to-black shadow-[0_0_48px_rgba(56,189,248,0.22)]";

  const labelClass = isFinal
    ? "text-yellow-300"
    : isGold
      ? "text-amber-300"
      : "text-cyan-300";

  const countClass = isFinal
    ? "text-yellow-100"
    : isGold
      ? "text-amber-100"
      : "text-cyan-100";

  const vsClass = isFinal
    ? "text-yellow-300"
    : isGold
      ? "text-amber-300"
      : "text-cyan-300";

  const titleClass = isFinal ? "text-yellow-100" : "text-white";

  const countdownLabel =
    seconds === null
      ? ""
      : seconds <= 0
        ? "GO"
        : String(seconds);

  const contextLabel = isFinal
    ? "Championship match"
    : isGold
      ? "Tournament match"
      : "Ranked match";

  return (
    <div
      className="p444-staging-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-6 backdrop-blur-sm"
      aria-live="polite"
      aria-label="Match starting"
    >
      <div
        className={`p444-staging-card w-full max-w-md overflow-hidden rounded-3xl border-2 px-5 py-7 text-center sm:px-7 sm:py-8 ${cardClass}`}
      >
        <p
          className={`text-[10px] font-black uppercase tracking-[0.32em] ${labelClass}`}
        >
          {tournamentName ?? contextLabel}
        </p>
        <h2
          className={`mt-2 break-words text-2xl font-black tracking-tight sm:text-3xl ${titleClass}`}
        >
          {title}
        </h2>
        <div className="mt-5 flex items-center justify-center gap-2 text-sm font-bold text-zinc-200 sm:text-base">
          <span className="min-w-0 max-w-[40%] truncate text-white">
            {leftName}
          </span>
          <span
            className={`p444-staging-vs shrink-0 text-[10px] font-black uppercase tracking-[0.28em] ${vsClass}`}
          >
            vs
          </span>
          <span className="min-w-0 max-w-[40%] truncate text-white">
            {rightName}
          </span>
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-zinc-400 sm:text-sm">
          Starting in
        </p>
        <p
          key={countdownLabel}
          className={`p444-staging-count mt-2 text-7xl font-black tabular-nums leading-none sm:text-8xl ${countClass}`}
        >
          {countdownLabel}
        </p>
        <p className="mt-5 text-[11px] font-semibold text-zinc-400">
          {isFinal
            ? "Winner takes the title."
            : isGold
              ? "First to finish the shootout advances."
              : "Lock in. Stay sharp."}
        </p>
      </div>
    </div>
  );
}
