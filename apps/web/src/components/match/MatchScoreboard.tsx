"use client";

import type { Role } from "./matchPresentation";

/**
 * Match scoreboard.
 *
 * Presentation-only. Single compact row: your name/score on the left, a
 * thin "vs" divider in the middle, opponent's name/score on the right.
 * Highlights the active KICKER (gold ring + pulse) and keeps a strong
 * score hierarchy without the height of two separate stacked cards.
 *
 * The parent must already own `myRole` / `opponentRole` / `scorePulse` etc.
 * — this component does not touch sockets, gameplay rules, or persistence.
 */
export default function MatchScoreboard({
  myName,
  opponentName,
  myScore,
  opponentScore,
  myRole,
  opponentRole,
  scorePulse,
  isSuddenDeath,
  isTournament,
  isFinal,
}: {
  myName: string;
  opponentName: string;
  myScore: number;
  opponentScore: number;
  myRole: Role | null;
  opponentRole: Role | null;
  scorePulse: "p1" | "p2" | null;
  isSuddenDeath: boolean;
  isTournament: boolean;
  isFinal: boolean;
}) {
  const goldTrim = isTournament || isFinal;

  return (
    <section
      className="flex items-center justify-between gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/95 px-2 py-1.5 shadow-xl sm:gap-4 sm:rounded-3xl sm:px-5 sm:py-4 md:rounded-[2rem] md:px-7 md:py-5"
      aria-label="Match score"
    >
      <PlayerSide
        name={myName}
        score={myScore}
        roleLabel={myRole === "KICKER" ? "Kicker" : myRole === "KEEPER" ? "Keeper" : null}
        isYou
        isActive={myRole === "KICKER"}
        scorePulse={scorePulse === "p1"}
        isFinal={isFinal}
        goldTrim={goldTrim}
        align="left"
      />

      <div className="flex shrink-0 flex-col items-center px-1 sm:px-2">
        <span
          className={`text-[9px] font-black uppercase tracking-[0.2em] sm:text-xs ${
            isSuddenDeath ? "text-yellow-300/80" : "text-zinc-600"
          }`}
        >
          vs
        </span>
      </div>

      <PlayerSide
        name={opponentName}
        score={opponentScore}
        roleLabel={
          opponentRole === "KICKER"
            ? "Kicker"
            : opponentRole === "KEEPER"
              ? "Keeper"
              : null
        }
        isYou={false}
        isActive={opponentRole === "KICKER"}
        scorePulse={scorePulse === "p2"}
        isFinal={isFinal}
        goldTrim={goldTrim}
        align="right"
      />
    </section>
  );
}

function PlayerSide({
  name,
  score,
  roleLabel,
  isYou,
  isActive,
  scorePulse,
  isFinal,
  goldTrim,
  align,
}: {
  name: string;
  score: number;
  roleLabel: string | null;
  isYou: boolean;
  isActive: boolean;
  scorePulse: boolean;
  isFinal: boolean;
  goldTrim: boolean;
  align: "left" | "right";
}) {
  const isRight = align === "right";

  const badgeClass = isYou
    ? "bg-white text-black"
    : "border border-zinc-600 text-zinc-300";

  return (
    <div className={`min-w-0 flex-1 ${isRight ? "text-right" : "text-left"}`}>
      <div
        className={`flex items-center gap-1.5 ${
          isRight ? "justify-end" : "justify-start"
        }`}
      >
        {isRight ? roleBadge() : null}
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black sm:px-2.5 sm:text-[10px] ${badgeClass}`}
        >
          {isYou ? "YOU" : "OPP"}
        </span>
        {!isRight ? roleBadge() : null}
      </div>
      <p className="truncate text-[10px] text-zinc-400 sm:mt-0.5 sm:text-sm">
        {name}
      </p>
      <p
        className={`text-xl font-black tabular-nums leading-none transition-all duration-500 ease-out sm:text-4xl md:text-5xl ${
          scorePulse
            ? "match-score-pulse scale-[1.24] text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.65)]"
            : "text-white"
        }`}
      >
        {score}
      </p>
    </div>
  );

  function roleBadge() {
    if (isActive) {
      return (
        <span
          className={`p444-kicker-badge-pulse rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.18em] sm:text-[9px] sm:tracking-[0.22em] ${
            isFinal
              ? "bg-yellow-400/20 text-yellow-100 ring-1 ring-yellow-300/60"
              : goldTrim
                ? "bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/55"
                : "bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-400/55"
          }`}
          aria-label="Kicker this round"
        >
          • Kicker
        </span>
      );
    }
    if (roleLabel) {
      return (
        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.18em] text-zinc-300 sm:text-[9px] sm:tracking-[0.22em]">
          {roleLabel}
        </span>
      );
    }
    return null;
  }
}
