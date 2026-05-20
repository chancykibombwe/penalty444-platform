"use client";

import { useMemo } from "react";
import {
  deriveTournamentStage,
  deriveTournamentSummary,
} from "../../lib/tournament/tournamentPresence";
import type { TournamentMatchRow } from "./TournamentBracketPanel";
import type { TournamentEntryRow } from "./TournamentListPanel";
import TournamentStageBanner from "./TournamentStageBanner";

type TournamentSummaryStatsProps = {
  tournamentStatus: string;
  entries: TournamentEntryRow[];
  matches: TournamentMatchRow[];
  championName?: string | null;
};

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "live" | "ready" | "alive" | "done";
}) {
  const toneClass = {
    neutral: "border-zinc-800 bg-zinc-950/55",
    live: "border-cyan-400/40 bg-cyan-950/25 shadow-[0_0_18px_rgba(34,211,238,0.12)]",
    ready: "border-amber-400/35 bg-amber-950/20",
    alive: "border-emerald-400/35 bg-emerald-950/20",
    done: "border-zinc-700 bg-zinc-900/60",
  }[tone];

  const valueColor = {
    neutral: "text-white",
    live: "text-cyan-100",
    ready: "text-amber-100",
    alive: "text-emerald-100",
    done: "text-zinc-200",
  }[tone];

  return (
    <div className={`rounded-2xl border px-3 py-3 sm:px-4 sm:py-4 ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[11px]">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-black tabular-nums sm:text-3xl ${valueColor}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] font-semibold text-zinc-500 sm:text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export default function TournamentSummaryStats({
  tournamentStatus,
  entries,
  matches,
  championName = null,
}: TournamentSummaryStatsProps) {
  const summary = useMemo(
    () =>
      deriveTournamentSummary({
        tournamentStatus,
        entries,
        matches,
      }),
    [tournamentStatus, entries, matches]
  );

  const stage = useMemo(
    () =>
      deriveTournamentStage({
        tournamentStatus,
        matches,
        remainingPlayers: summary.remaining,
      }),
    [tournamentStatus, matches, summary.remaining]
  );

  if (summary.registered === 0 && summary.matchesTotal === 0) {
    return null;
  }

  const isLive = tournamentStatus === "in_progress";
  const isCompleted = tournamentStatus === "completed";

  const sectionClass =
    stage.intensity === "peak" && (isLive || isCompleted)
      ? "rounded-2xl border-2 border-yellow-300/40 bg-gradient-to-br from-yellow-950/35 via-zinc-950 to-black p-4 shadow-2xl shadow-yellow-900/25 sm:p-5"
      : stage.intensity === "high" && isLive
        ? "rounded-2xl border-2 border-fuchsia-400/35 bg-gradient-to-br from-fuchsia-950/35 via-zinc-950 to-black p-4 shadow-xl shadow-fuchsia-900/20 sm:p-5"
        : stage.intensity === "rising" && isLive
          ? "rounded-2xl border-2 border-cyan-400/30 bg-gradient-to-br from-cyan-950/25 via-zinc-950 to-black p-4 shadow-xl shadow-cyan-900/15 sm:p-5"
          : "rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4 shadow-xl sm:p-5";

  return (
    <section className={sectionClass} aria-label="Tournament summary">
      <TournamentStageBanner
        tournamentStatus={tournamentStatus}
        stage={stage}
        remainingPlayers={summary.remaining}
        championName={championName}
      />

      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 sm:text-xs">
            Tournament pulse
          </p>
          <h2 className="mt-1 text-base font-bold text-white sm:text-lg">
            {isLive
              ? "Live snapshot"
              : isCompleted
                ? "Final standings"
                : "Lobby status"}
          </h2>
        </div>
        {summary.currentRoundLabel ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300"
              aria-hidden
            />
            {summary.currentRoundLabel}
            {summary.totalRounds > 0 && summary.currentRoundNumber
              ? ` · ${summary.currentRoundNumber}/${summary.totalRounds}`
              : null}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <StatCard
          label="Registered"
          value={summary.registered}
          hint={summary.ready ? `${summary.ready} ready` : undefined}
        />
        <StatCard
          label={isCompleted ? "Champion" : "Alive"}
          value={summary.remaining}
          tone="alive"
          hint={
            isLive && summary.registered > 0
              ? `of ${summary.registered}`
              : undefined
          }
        />
        <StatCard
          label="Live"
          value={summary.matchesLive}
          tone={summary.matchesLive > 0 ? "live" : "neutral"}
          hint={summary.matchesLive > 0 ? "Matches in progress" : "—"}
        />
        <StatCard
          label="Waiting"
          value={summary.matchesWaiting}
          tone="ready"
          hint="Pending / ready"
        />
        <StatCard
          label="Completed"
          value={summary.matchesCompleted}
          tone="done"
          hint={
            summary.matchesTotal
              ? `of ${summary.matchesTotal} matches`
              : undefined
          }
        />
        <StatCard
          label="Rounds"
          value={
            summary.totalRounds > 0
              ? summary.totalRounds
              : summary.matchesTotal
                ? "—"
                : 0
          }
          hint={
            summary.totalRounds > 0 ? "Single elimination" : "Bracket pending"
          }
        />
      </div>
    </section>
  );
}
