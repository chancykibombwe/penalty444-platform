"use client";

import {
  getStageBorderClass,
  getStageDotClass,
  type TournamentStage,
} from "../../lib/tournament/tournamentPresence";

type TournamentStageBannerProps = {
  tournamentStatus: string;
  stage: TournamentStage;
  remainingPlayers: number;
  championName: string | null;
};

const BANNER_PULSE_STYLE = `
@keyframes tournamentStagePulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
.tournament-stage-pulse {
  animation: tournamentStagePulse 1.6s ease-in-out infinite;
}
`;

function buildHeadline(
  status: string,
  stage: TournamentStage,
  remainingPlayers: number,
  championName: string | null
): { title: string; detail: string } | null {
  if (status === "cancelled") {
    return { title: "Tournament cancelled", detail: "No champion crowned." };
  }

  if (status === "completed") {
    return {
      title: championName
        ? `${championName} wins the tournament`
        : "Tournament complete",
      detail: stage.totalRounds
        ? `${stage.totalRounds} rounds played · Champion crowned`
        : "Champion crowned",
    };
  }

  if (stage.isFinalActive) {
    return {
      title: "Championship match begins",
      detail: "Last match standing — winner takes the tournament.",
    };
  }

  if (stage.isLastFourReached && stage.isFinalRound === false) {
    return {
      title: "Semifinals are live",
      detail:
        remainingPlayers > 0
          ? `${remainingPlayers} players remaining · Winners reach the final`
          : "Winners reach the final",
    };
  }

  if (
    stage.intensity === "rising" &&
    stage.stageLabel.toLowerCase().includes("quarterfinal")
  ) {
    return {
      title: "Quarterfinals underway",
      detail:
        remainingPlayers > 0
          ? `${remainingPlayers} players remaining`
          : "Field narrowing",
    };
  }

  if (status === "in_progress" && stage.stageRoundNumber !== null) {
    return {
      title: `${stage.stageLabel} underway`,
      detail:
        remainingPlayers > 0
          ? `${remainingPlayers} players remaining`
          : "Matches in progress",
    };
  }

  if (status === "registration") {
    return {
      title: "Registration open",
      detail: "Waiting for players to join.",
    };
  }

  if (status === "check_in") {
    return {
      title: "Ready phase",
      detail: "Players marking themselves ready.",
    };
  }

  return null;
}

export default function TournamentStageBanner({
  tournamentStatus,
  stage,
  remainingPlayers,
  championName,
}: TournamentStageBannerProps) {
  const headline = buildHeadline(
    tournamentStatus,
    stage,
    remainingPlayers,
    championName
  );
  if (!headline) return null;

  const intensity = stage.intensity;
  const isPeak = intensity === "peak";

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border px-4 py-3 sm:px-5 sm:py-4 ${getStageBorderClass(
        intensity
      )}`}
      aria-label="Tournament stage"
    >
      <style dangerouslySetInnerHTML={{ __html: BANNER_PULSE_STYLE }} />
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
            isPeak
              ? "border-yellow-300/60 bg-yellow-500/15 text-yellow-100"
              : "border-white/15 bg-black/30 text-white/85"
          }`}
        >
          <span
            className={`tournament-stage-pulse inline-block h-1.5 w-1.5 rounded-full ${getStageDotClass(
              intensity
            )}`}
            aria-hidden
          />
          {stage.stageLabel}
        </span>
        {stage.totalRounds > 0 && stage.stageRoundNumber !== null ? (
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75">
            Round {stage.stageRoundNumber}/{stage.totalRounds}
          </span>
        ) : null}
        {stage.progressionPct > 0 && tournamentStatus === "in_progress" ? (
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-75">
            {stage.progressionPct}% complete
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-col gap-1">
        <p
          className={`break-words text-base font-black tracking-tight sm:text-lg ${
            isPeak ? "text-yellow-100" : "text-white"
          }`}
        >
          {isPeak && tournamentStatus !== "cancelled" ? "🏆 " : null}
          {headline.title}
        </p>
        <p className="text-xs font-semibold leading-relaxed opacity-85 sm:text-sm">
          {headline.detail}
        </p>
      </div>

      {stage.progressionPct > 0 && tournamentStatus === "in_progress" ? (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-black/40">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isPeak
                ? "bg-gradient-to-r from-yellow-300 to-amber-500"
                : intensity === "high"
                  ? "bg-gradient-to-r from-fuchsia-400 to-pink-500"
                  : intensity === "rising"
                    ? "bg-gradient-to-r from-cyan-300 to-sky-500"
                    : "bg-zinc-500"
            }`}
            style={{ width: `${stage.progressionPct}%` }}
            aria-hidden
          />
        </div>
      ) : null}
    </section>
  );
}
