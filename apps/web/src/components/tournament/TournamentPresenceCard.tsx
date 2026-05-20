"use client";

import {
  getPresenceExplanation,
  getPresenceLabel,
  getPresenceToneClass,
  type TournamentPresence,
} from "../../lib/tournament/tournamentPresence";

type TournamentPresenceCardProps = {
  presence: TournamentPresence;
  tournamentStatus: string;
  hasReadyMatch?: boolean;
  /** Optional round label like "Quarterfinals". */
  currentRoundLabel?: string | null;
  /** Label for the player's NEXT match if known (e.g. "Semifinals"). */
  nextStageLabel?: string | null;
  /** True if the player's next match is the championship. */
  nextMatchIsFinal?: boolean;
  /** True if the bracket's final match is currently live. */
  championshipLive?: boolean;
  /** Hide the card entirely when the user is not engaged with the tournament. */
  hideWhenViewing?: boolean;
};

const TONE_ICON: Record<TournamentPresence, string> = {
  VIEWING: "👁",
  WAITING: "⏳",
  IN_MATCH: "🎯",
  ELIMINATED: "✕",
  CHAMPION: "🏆",
  RECONNECTING: "↻",
};

export default function TournamentPresenceCard({
  presence,
  tournamentStatus,
  hasReadyMatch = false,
  currentRoundLabel,
  nextStageLabel = null,
  nextMatchIsFinal = false,
  championshipLive = false,
  hideWhenViewing = false,
}: TournamentPresenceCardProps) {
  if (hideWhenViewing && presence === "VIEWING") {
    return null;
  }

  const explanation = getPresenceExplanation(presence, {
    tournamentStatus,
    hasReadyMatch,
    nextStageLabel,
    nextMatchIsFinal,
    championshipLive,
  });

  // Championship boost: when the user is one match away from / inside the final.
  const isChampionshipBoost =
    (nextMatchIsFinal && (presence === "IN_MATCH" || presence === "WAITING")) ||
    presence === "CHAMPION";

  const ringClass = isChampionshipBoost
    ? "ring-yellow-300/65"
    : {
        VIEWING: "ring-zinc-700/40",
        WAITING: "ring-sky-400/35",
        IN_MATCH: "ring-cyan-400/45",
        ELIMINATED: "ring-red-400/35",
        CHAMPION: "ring-yellow-300/55",
        RECONNECTING: "ring-amber-400/40",
      }[presence];

  const toneClass = isChampionshipBoost
    ? "border-yellow-300/65 bg-yellow-500/15 text-yellow-100"
    : getPresenceToneClass(presence);

  return (
    <section
      className={`rounded-2xl border bg-zinc-950/65 p-4 shadow-lg ring-1 sm:p-5 ${toneClass} ${ringClass}`}
      aria-label="Your tournament status"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-xl"
          aria-hidden
        >
          {TONE_ICON[presence]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70 sm:text-xs">
              Your status
            </p>
            <span className="inline-flex items-center rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-white">
              {getPresenceLabel(presence)}
            </span>
            {currentRoundLabel && (presence === "IN_MATCH" || presence === "WAITING") ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/85">
                {currentRoundLabel}
              </span>
            ) : null}
            {nextMatchIsFinal && (presence === "IN_MATCH" || presence === "WAITING") ? (
              <span className="inline-flex items-center rounded-full border border-yellow-300/55 bg-yellow-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-yellow-100 shadow-[0_0_16px_rgba(234,179,8,0.25)]">
                🏆 Championship
              </span>
            ) : null}
            {championshipLive && presence !== "IN_MATCH" && presence !== "CHAMPION" ? (
              <span className="inline-flex items-center rounded-full border border-yellow-300/45 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-100">
                Final is live
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-semibold leading-snug text-white sm:text-base">
            {explanation}
          </p>
        </div>
      </div>
    </section>
  );
}
