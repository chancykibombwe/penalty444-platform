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
 * Below the score row, a compact PROGRESS checklist shows how far the match
 * has advanced (completed / current / pending shots). It is intentionally
 * progress-only: the scoreboard only receives cumulative scores, not a
 * per-turn outcome history, so we never infer per-round win/loss on the
 * client. True per-round win/loss indicators would require existing
 * round-history data to be exposed to this component safely.
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
  currentTurn,
  totalTurns,
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
  /** Current turn/shot number (1-indexed). Optional — progress row hides if absent. */
  currentTurn?: number;
  /** Total turns/shots in normal play (maxRounds × 2). Optional. */
  totalTurns?: number;
}) {
  const goldTrim = isTournament || isFinal;

  return (
    <section
      className={`flex flex-col gap-1.5 rounded-lg border bg-zinc-950/95 px-2 py-1.5 shadow-xl sm:gap-2 sm:rounded-3xl sm:px-5 sm:py-4 md:rounded-[2rem] md:px-7 md:py-5 ${
        isSuddenDeath
          ? "border-yellow-500/40 shadow-[0_0_20px_rgba(234,179,8,0.08)]"
          : isFinal
            ? "border-yellow-400/30 shadow-[0_0_20px_rgba(234,179,8,0.06)]"
            : goldTrim
              ? "border-amber-500/25"
              : "border-zinc-800"
      }`}
      aria-label="Match score"
    >
      <div className="flex items-center justify-between gap-3 sm:gap-4">
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

      <div className="flex shrink-0 flex-col items-center gap-0.5 px-0.5 sm:px-2">
        <div className={`hidden h-4 w-px sm:block ${isSuddenDeath ? "bg-yellow-500/30" : "bg-zinc-800"}`} />
        <span
          className={`text-[9px] font-black uppercase tracking-[0.2em] sm:text-xs ${
            isSuddenDeath ? "text-yellow-300/80" : "text-zinc-600"
          }`}
        >
          vs
        </span>
        <div className={`hidden h-4 w-px sm:block ${isSuddenDeath ? "bg-yellow-500/30" : "bg-zinc-800"}`} />
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
      </div>

      <RoundProgress
        currentTurn={currentTurn}
        totalTurns={totalTurns}
        isSuddenDeath={isSuddenDeath}
        goldTrim={goldTrim}
        isFinal={isFinal}
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
      {/* Badge + name on one row — collapses 3 stacked rows to 2 */}
      <div
        className={`flex min-w-0 items-center gap-0.5 sm:gap-1 ${
          isRight ? "justify-end" : "justify-start"
        }`}
      >
        {isRight ? roleBadge() : null}
        <span
          className={`shrink-0 rounded-full px-1 py-0 text-[7px] font-black sm:px-2.5 sm:py-0.5 sm:text-[10px] ${badgeClass}`}
        >
          {isYou ? "YOU" : "OPP"}
        </span>
        {!isRight ? roleBadge() : null}
        <p className="min-w-0 truncate text-[8px] text-zinc-400 sm:text-sm">
          {name}
        </p>
      </div>
      <p
        className={`text-base font-black tabular-nums leading-none transition-all duration-500 ease-out sm:mt-0.5 sm:text-4xl md:text-5xl ${
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
          className={`p444-kicker-badge-pulse rounded-full px-1 py-0 text-[6px] font-black uppercase tracking-[0.14em] sm:px-1.5 sm:py-0.5 sm:text-[9px] sm:tracking-[0.22em] ${
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
        <span className="rounded-full border border-zinc-700 px-1 py-0 text-[6px] font-black uppercase tracking-[0.14em] text-zinc-300 sm:px-1.5 sm:py-0.5 sm:text-[9px] sm:tracking-[0.22em]">
          {roleLabel}
        </span>
      );
    }
    return null;
  }
}

/**
 * Compact per-shot PROGRESS checklist.
 *
 * Renders a small row of dots — one per normal-play shot (turn) — showing
 * completed shots (filled), the current shot (highlighted), and pending
 * shots (dimmed). This is progress-only on purpose: we only have cumulative
 * scores here, so we do NOT derive per-shot win/loss on the client.
 *
 * TODO: true per-round win/loss indicators (green = scored, red = saved/miss)
 * would require the existing authoritative round-history to be passed into
 * this component. Until that data is exposed safely, we show progress only —
 * never inventing outcomes.
 *
 * Sudden death is open-ended (no fixed shot count), so we show a compact
 * "Sudden Death" badge instead of a dot row.
 */
function RoundProgress({
  currentTurn,
  totalTurns,
  isSuddenDeath,
  goldTrim,
  isFinal,
}: {
  currentTurn?: number;
  totalTurns?: number;
  isSuddenDeath: boolean;
  goldTrim: boolean;
  isFinal: boolean;
}) {
  if (isSuddenDeath) {
    return (
      <div className="flex items-center justify-center">
        <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.18em] text-yellow-200/90 sm:text-[9px]">
          <span className="h-1 w-1 animate-pulse rounded-full bg-yellow-300" aria-hidden />
          Sudden Death
        </span>
      </div>
    );
  }

  // Need a sane, positive shot count to render the checklist.
  if (
    typeof totalTurns !== "number" ||
    !Number.isFinite(totalTurns) ||
    totalTurns <= 0
  ) {
    return null;
  }

  const total = Math.min(Math.floor(totalTurns), 30); // guard against odd data
  const current =
    typeof currentTurn === "number" && Number.isFinite(currentTurn)
      ? Math.floor(currentTurn)
      : 0;

  const activeDot = isFinal
    ? "bg-yellow-300 ring-1 ring-yellow-200/70"
    : goldTrim
      ? "bg-amber-300 ring-1 ring-amber-200/70"
      : "bg-cyan-300 ring-1 ring-cyan-200/70";

  const completedCount = Math.max(0, Math.min(current - 1, total));

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-1"
      role="img"
      aria-label={`Shot progress: ${Math.min(Math.max(current, 0), total)} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const shot = i + 1;
        const isCompleted = shot < current;
        const isActive = shot === current;
        return (
          <span
            key={shot}
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors sm:h-2 sm:w-2 ${
              isActive
                ? `${activeDot} animate-pulse`
                : isCompleted
                  ? "bg-zinc-400"
                  : "bg-zinc-700"
            }`}
          />
        );
      })}
      <span className="ml-1 text-[8px] font-bold tabular-nums text-zinc-600 sm:text-[9px]">
        {completedCount}/{total}
      </span>
    </div>
  );
}
