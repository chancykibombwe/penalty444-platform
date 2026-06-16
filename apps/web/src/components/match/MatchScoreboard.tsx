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
      className="flex h-full items-center justify-between gap-1 rounded-2xl border border-zinc-800 bg-zinc-950/95 px-2 py-1 shadow"
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

      <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center">
        <p className="flex items-baseline gap-1 text-[32px] font-black leading-none tabular-nums">
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
          className={`text-[10px] font-black uppercase tracking-[0.14em] ${
            isSuddenDeath ? "text-amber-300/90" : "text-zinc-500"
          }`}
        >
          Round {roundLabel}
        </p>

        <p
          className={`text-xs font-black tabular-nums ${
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
      ? "ring-1 ring-yellow-300/65"
      : goldTrim
        ? "ring-1 ring-amber-400/55"
        : "ring-1 ring-cyan-400/55"
    : isSuddenDeath
      ? "ring-1 ring-yellow-500/40"
      : "";

  const badgeClass = isYou
    ? "bg-white text-black"
    : "border border-zinc-600 text-zinc-300";

  return (
    <div
      className={`min-w-0 flex-1 rounded-xl p-1 transition-all duration-300 ${ringClass} ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <div
        className={`flex items-center gap-0.5 ${
          align === "right" ? "flex-row-reverse justify-start" : ""
        }`}
      >
        <p className="truncate text-[11px] font-bold leading-none text-zinc-200">
          {name}
        </p>
        <span
          className={`shrink-0 rounded-full px-1 py-px text-[8px] font-black ${badgeClass}`}
        >
          {isYou ? "YOU" : "OPP"}
        </span>
      </div>

      {isActive ? (
        <span
          className={`p444-kicker-badge-pulse mt-0.5 inline-block rounded-full px-1.5 py-px text-[8px] font-black uppercase ${
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
        <span className="mt-0.5 inline-block rounded-full border border-zinc-700 px-1.5 py-px text-[8px] font-black uppercase text-zinc-300">
          {roleLabel}
        </span>
      ) : null}

      <div
        className={`mt-1 flex flex-wrap gap-1 ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
        aria-label="Round results"
      >
        {roundResults.map((outcome, index) => (
          <span
            key={index}
            className={`h-4 w-4 shrink-0 rounded-full ${
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
