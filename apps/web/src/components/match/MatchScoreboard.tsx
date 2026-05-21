"use client";

import type { Role } from "./matchPresentation";

/**
 * Match scoreboard.
 *
 * Presentation-only. Highlights the active KICKER (gold ring + pulse) and
 * keeps a strong score hierarchy. Mobile layout stacks vertically; desktop
 * splits side-by-side.
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
      className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-2 md:gap-6"
      aria-label="Match score"
    >
      <PlayerCard
        name={myName}
        score={myScore}
        role={myRole}
        roleLabel={myRole === "KICKER" ? "Kicker" : myRole === "KEEPER" ? "Keeper" : null}
        isYou
        isActive={myRole === "KICKER"}
        scorePulse={scorePulse === "p1"}
        isSuddenDeath={isSuddenDeath}
        isFinal={isFinal}
        goldTrim={goldTrim}
      />
      <PlayerCard
        name={opponentName}
        score={opponentScore}
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
        scorePulse={scorePulse === "p2"}
        isSuddenDeath={isSuddenDeath}
        isFinal={isFinal}
        goldTrim={goldTrim}
      />
    </section>
  );
}

function PlayerCard({
  name,
  score,
  role: _role,
  roleLabel,
  isYou,
  isActive,
  scorePulse,
  isSuddenDeath,
  isFinal,
  goldTrim,
}: {
  name: string;
  score: number;
  role: Role | null;
  roleLabel: string | null;
  isYou: boolean;
  isActive: boolean;
  scorePulse: boolean;
  isSuddenDeath: boolean;
  isFinal: boolean;
  goldTrim: boolean;
}) {
  const baseBorder = isActive
    ? isFinal
      ? "border-yellow-300/65 shadow-[0_0_28px_rgba(234,179,8,0.28)]"
      : goldTrim
        ? "border-amber-400/55 shadow-[0_0_24px_rgba(251,191,36,0.22)]"
        : "border-cyan-400/55 shadow-[0_0_24px_rgba(56,189,248,0.22)]"
    : isSuddenDeath
      ? "border-yellow-500/45 shadow-[0_0_18px_rgba(234,179,8,0.16)]"
      : "border-zinc-800";

  const badgeClass = isYou
    ? "bg-white text-black"
    : "border border-zinc-600 text-zinc-300";

  return (
    <div
      className={`min-w-0 rounded-3xl border bg-zinc-950/95 p-4 shadow-xl transition-all duration-300 sm:p-5 md:rounded-[2rem] md:p-7 ${baseBorder}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
          {isYou ? "Your Score" : "Opponent"}
        </p>
        {isActive ? (
          <span
            className={`p444-kicker-badge-pulse rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] ${
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
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-300">
            {roleLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-xs text-zinc-400 sm:text-sm md:mt-2">
        {name}
      </p>
      <div className="mt-3 flex items-end justify-between gap-2 md:mt-4 md:gap-4">
        <p
          className={`text-5xl font-black tabular-nums transition-all duration-500 ease-out sm:text-6xl md:text-7xl ${
            scorePulse
              ? "match-score-pulse scale-[1.24] text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.65)]"
              : "text-white"
          }`}
        >
          {score}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black sm:px-3 sm:py-1 sm:text-xs ${badgeClass}`}
        >
          {isYou ? "YOU" : "OPP"}
        </span>
      </div>
    </div>
  );
}
