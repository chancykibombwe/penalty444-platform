"use client";

import type { Role } from "./matchPresentation";

export type RoundOutcome = "goal" | "miss" | "pending";

/**
 * Match scoreboard.
 *
 * Presentation-only. Single-row layout: player (with round checklist) on
 * each side, score/round/timer in the center. Highlights the active
 * KICKER (gold ring + pulse) and keeps a strong score hierarchy.
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
  roundLabel,
  timer,
  isTimerUrgent,
  myRoundResults,
  opponentRoundResults,
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
  roundLabel: string;
  timer: number | null;
  isTimerUrgent: boolean;
  myRoundResults: RoundOutcome[];
  opponentRoundResults: RoundOutcome[];
}) {
  const goldTrim = isTournament || isFinal;

  return (
    <section
      className="flex items-center justify-between gap-2 rounded-3xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-xl sm:gap-4 sm:p-5 md:rounded-[2rem] md:p-7"
      aria-label="Match score"
    >
      <PlayerSide
        name={myName}
        role={myRole}
        roleLabel={myRole === "KICKER" ? "Kicker" : myRole === "KEEPER" ? "Keeper" : null}
        isYou
        isActive={myRole === "KICKER"}
        isSuddenDeath={isSuddenDeath}
        isFinal={isFinal}
        goldTrim={goldTrim}
        roundResults={myRoundResults}
        align="left"
      />

      <div className="flex min-w-0 flex-col items-center gap-1 px-1 text-center sm:gap-1.5">
        <p className="flex items-baseline gap-1.5 text-3xl font-black tabular-nums sm:gap-2 sm:text-4xl md:text-5xl">
          <span
            className={`transition-all duration-500 ease-out ${
              scorePulse === "p1"
                ? "match-score-pulse scale-[1.2] text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.6)]"
                : "text-white"
            }`}
          >
            {myScore}
          </span>
          <span className="text-zinc-600">-</span>
          <span
            className={`transition-all duration-500 ease-out ${
              scorePulse === "p2"
                ? "match-score-pulse scale-[1.2] text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.6)]"
                : "text-white"
            }`}
          >
            {opponentScore}
          </span>
        </p>

        <p
          className={`text-[10px] font-black uppercase tracking-[0.18em] sm:text-xs ${
            isSuddenDeath ? "text-amber-300/90" : "text-zinc-500"
          }`}
        >
          Round {roundLabel}
        </p>

        <p
          className={`text-base font-black tabular-nums sm:text-lg ${
            isTimerUrgent
              ? "text-red-300"
              : isSuddenDeath
                ? "text-yellow-200"
                : "text-zinc-300"
          }`}
        >
          {timer !== null ? `${timer}s` : "—"}
        </p>
      </div>

      <PlayerSide
        name={opponentName}
        role={opponentRole}
        roleLabel={
          opponentRole === "KICKER"
            ? "Kicker"
            : opponentRole === "KEEPER"
              ? "Keeper"
              : null
        }
        isYou={false}
        isActive={opponentRole === "KICKER"}
        isSuddenDeath={isSuddenDeath}
        isFinal={isFinal}
        goldTrim={goldTrim}
        roundResults={opponentRoundResults}
        align="right"
      />
    </section>
  );
}

function PlayerSide({
  name,
  role: _role,
  roleLabel,
  isYou,
  isActive,
  isSuddenDeath,
  isFinal,
  goldTrim,
  roundResults,
  align,
}: {
  name: string;
  role: Role | null;
  roleLabel: string | null;
  isYou: boolean;
  isActive: boolean;
  isSuddenDeath: boolean;
  isFinal: boolean;
  goldTrim: boolean;
  roundResults: RoundOutcome[];
  align: "left" | "right";
}) {
  const ringClass = isActive
    ? isFinal
      ? "ring-2 ring-yellow-300/65 shadow-[0_0_18px_rgba(234,179,8,0.25)]"
      : goldTrim
        ? "ring-2 ring-amber-400/55 shadow-[0_0_16px_rgba(251,191,36,0.2)]"
        : "ring-2 ring-cyan-400/55 shadow-[0_0_16px_rgba(56,189,248,0.2)]"
    : isSuddenDeath
      ? "ring-1 ring-yellow-500/40"
      : "";

  const badgeClass = isYou
    ? "bg-white text-black"
    : "border border-zinc-600 text-zinc-300";

  return (
    <div
      className={`min-w-0 flex-1 rounded-2xl p-1.5 transition-all duration-300 sm:p-2 ${ringClass} ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <div
        className={`flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse justify-start" : ""
        }`}
      >
        <p className="truncate text-xs font-bold text-zinc-200 sm:text-sm">
          {name}
        </p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black sm:px-2 ${badgeClass}`}
        >
          {isYou ? "YOU" : "OPP"}
        </span>
      </div>

      {isActive ? (
        <span
          className={`p444-kicker-badge-pulse mt-1 inline-block rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.2em] sm:text-[9px] ${
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
      ) : roleLabel ? (
        <span className="mt-1 inline-block rounded-full border border-zinc-700 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.2em] text-zinc-300 sm:text-[9px]">
          {roleLabel}
        </span>
      ) : null}

      <div
        className={`mt-1.5 flex flex-wrap gap-1 sm:mt-2 sm:gap-1.5 ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
        aria-label="Round results"
      >
        {roundResults.map((outcome, index) => (
          <span
            key={index}
            className={`h-2.5 w-2.5 shrink-0 rounded-full sm:h-3 sm:w-3 ${
              outcome === "goal"
                ? "bg-emerald-500"
                : outcome === "miss"
                  ? "bg-red-500"
                  : "bg-zinc-700"
            }`}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}
