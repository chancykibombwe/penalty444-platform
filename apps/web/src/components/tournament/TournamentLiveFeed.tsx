"use client";

import { useMemo } from "react";
import {
  deriveTournamentFeed,
  type TournamentFeedEvent,
  type TournamentFeedTone,
} from "../../lib/tournament/liveFeed";
import type { TournamentMatchRow } from "./TournamentBracketPanel";
import type {
  TournamentEntryRow,
  TournamentRow,
} from "./TournamentListPanel";

type TournamentLiveFeedProps = {
  tournament: TournamentRow | null;
  entries: TournamentEntryRow[];
  matches: TournamentMatchRow[];
  limit?: number;
};

const TONE_DOT: Record<TournamentFeedTone, string> = {
  neutral: "bg-zinc-500",
  info: "bg-sky-400",
  live: "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]",
  good: "bg-emerald-400",
  warn: "bg-amber-400",
  victory: "bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.7)]",
};

const TONE_BORDER: Record<TournamentFeedTone, string> = {
  neutral: "border-zinc-800",
  info: "border-sky-500/30",
  live: "border-cyan-400/45",
  good: "border-emerald-500/30",
  warn: "border-amber-500/35",
  victory: "border-yellow-300/45",
};

function formatRelative(timestamp: number): string {
  if (!timestamp) return "";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "soon";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function FeedRow({ event }: { event: TournamentFeedEvent }) {
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border bg-zinc-950/55 px-3.5 py-2.5 ${
        TONE_BORDER[event.tone]
      }`}
    >
      <span
        className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
          TONE_DOT[event.tone]
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold text-white">
          {event.title}
        </p>
        {event.detail ? (
          <p className="mt-0.5 break-words text-xs text-zinc-400">
            {event.detail}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        {formatRelative(event.timestamp)}
      </span>
    </li>
  );
}

export default function TournamentLiveFeed({
  tournament,
  entries,
  matches,
  limit = 10,
}: TournamentLiveFeedProps) {
  const events = useMemo(
    () => deriveTournamentFeed({ tournament, entries, matches, limit }),
    [tournament, entries, matches, limit]
  );

  if (!tournament || events.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 sm:p-5"
      aria-label="Tournament activity feed"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 sm:text-xs">
            Live Feed
          </p>
          <h2 className="mt-1 text-base font-bold text-white sm:text-lg">
            Tournament activity
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Updating
        </span>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {events.map((event) => (
          <FeedRow key={event.id} event={event} />
        ))}
      </ul>
    </section>
  );
}
