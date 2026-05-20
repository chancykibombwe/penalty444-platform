"use client";

import { useMemo } from "react";
import { deriveLiveMatches } from "../../lib/tournament/liveFeed";
import type { TournamentMatchRow } from "./TournamentBracketPanel";
import type { TournamentEntryRow } from "./TournamentListPanel";

type TournamentLiveNowProps = {
  entries: TournamentEntryRow[];
  matches: TournamentMatchRow[];
  /** Optional anchor href for "View on bracket" link. */
  bracketAnchorHref?: string;
};

const LIVE_PULSE_STYLE = `
@keyframes tournamentLiveNowGlow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.45), 0 0 22px rgba(34, 211, 238, 0.16); }
  50% { box-shadow: 0 0 0 10px rgba(34, 211, 238, 0), 0 0 32px rgba(34, 211, 238, 0.32); }
}
.tournament-live-now-card {
  animation: tournamentLiveNowGlow 2s ease-in-out infinite;
}
`;

export default function TournamentLiveNow({
  entries,
  matches,
  bracketAnchorHref = "#tournament-bracket",
}: TournamentLiveNowProps) {
  const liveMatches = useMemo(
    () => deriveLiveMatches({ entries, matches }),
    [entries, matches]
  );

  if (liveMatches.length === 0) {
    return null;
  }

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-cyan-500/35 bg-gradient-to-br from-cyan-950/30 via-zinc-950 to-black p-4 shadow-2xl sm:p-5"
      aria-label="Live tournament matches"
    >
      <style dangerouslySetInnerHTML={{ __html: LIVE_PULSE_STYLE }} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/60 bg-cyan-500/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
              aria-hidden
            />
            Live now
          </span>
          <span className="text-xs font-bold text-cyan-100/85">
            {liveMatches.length}{" "}
            {liveMatches.length === 1 ? "match" : "matches"} in progress
          </span>
        </div>
        <a
          href={bracketAnchorHref}
          className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
        >
          View bracket →
        </a>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {liveMatches.map((match) => (
          <li
            key={match.matchId}
            className={`tournament-live-now-card relative overflow-hidden rounded-xl border bg-zinc-950/60 px-3.5 py-3 ${
              match.isFinal
                ? "border-yellow-300/50 bg-gradient-to-br from-yellow-950/35 via-zinc-950 to-black"
                : "border-cyan-400/45"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                  match.isFinal
                    ? "border-yellow-300/55 bg-yellow-500/15 text-yellow-100"
                    : "border-cyan-400/55 bg-cyan-500/15 text-cyan-100"
                }`}
              >
                {match.isFinal ? "Final" : match.roundLabel}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {match.matchLabel}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">
                {match.entryOneName}
              </span>
              <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/85">
                vs
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-sm font-bold text-white">
                {match.entryTwoName}
              </span>
            </div>

            <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200/80">
              <span
                className="inline-block h-1 w-1 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.8)]"
                aria-hidden
              />
              Playing now
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
