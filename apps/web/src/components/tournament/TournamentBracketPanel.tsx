"use client";

import { useMemo } from "react";
import { getRoundLabel, getTotalRounds } from "../../lib/tournament/bracket";
import type { TournamentEntryRow } from "./TournamentListPanel";

export type TournamentMatchRow = {
  id: string;
  tournament_id: string;
  round_number: number;
  slot_index: number;
  entry_one_id: string | null;
  entry_two_id: string | null;
  room_code: string | null;
  status: string;
  winner_entry_id: string | null;
  next_match_id: string | null;
};

type TournamentBracketPanelProps = {
  matches: TournamentMatchRow[];
  entries: TournamentEntryRow[];
};

function entryLabel(
  entryId: string | null,
  entryById: Map<string, TournamentEntryRow>
): string {
  if (!entryId) return "TBD";
  const entry = entryById.get(entryId);
  return entry?.username ?? "Unknown";
}

function matchStatusClass(status: string) {
  switch (status) {
    case "completed":
    case "walkover":
      return "border-emerald-500/35 bg-emerald-950/20";
    case "in_progress":
      return "border-cyan-500/35 bg-cyan-950/20";
    case "ready":
      return "border-amber-500/35 bg-amber-950/20";
    case "cancelled":
      return "border-red-500/35 bg-red-950/20";
    default:
      return "border-zinc-700 bg-zinc-950/50";
  }
}

export default function TournamentBracketPanel({
  matches,
  entries,
}: TournamentBracketPanelProps) {
  const entryById = useMemo(() => {
    const map = new Map<string, TournamentEntryRow>();
    for (const entry of entries) {
      map.set(entry.id, entry);
    }
    return map;
  }, [entries]);

  const rounds = useMemo(() => {
    const byRound = new Map<number, TournamentMatchRow[]>();
    for (const match of matches) {
      const bucket = byRound.get(match.round_number) ?? [];
      bucket.push(match);
      byRound.set(match.round_number, bucket);
    }

    return Array.from(byRound.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNumber, roundMatches]) => ({
        roundNumber,
        matches: [...roundMatches].sort((a, b) => a.slot_index - b.slot_index),
      }));
  }, [matches]);

  const roundOneMatchCount =
    rounds.find((round) => round.roundNumber === 1)?.matches.length ?? 0;
  const totalRounds =
    roundOneMatchCount > 0
      ? getTotalRounds(roundOneMatchCount * 2)
      : 0;

  if (matches.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-xl font-bold text-white">Bracket</h2>
        <p className="mt-2 text-sm text-zinc-400">
          No matches yet. The creator can start the tournament after check-in
          when the checked-in count is a power of two (2, 4, 8, …).
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-8 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
      <div>
        <h2 className="text-xl font-bold text-white">Bracket</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Single elimination · winners advance in a later phase
        </p>
      </div>

      {rounds.map(({ roundNumber, matches: roundMatches }) => (
        <div key={roundNumber} className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-amber-200/90">
            {getRoundLabel(roundNumber, totalRounds)}
          </h3>

          <ul className="grid gap-3 md:grid-cols-2">
            {roundMatches.map((match) => (
              <li
                key={match.id}
                className={`rounded-xl border px-4 py-3 ${matchStatusClass(match.status)}`}
              >
                <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-zinc-500">
                  <span>Slot {match.slot_index + 1}</span>
                  <span className="capitalize">
                    {match.status.replace("_", " ")}
                  </span>
                </div>

                <div className="mt-2 space-y-1 text-sm">
                  <p className="font-semibold text-white">
                    {entryLabel(match.entry_one_id, entryById)}
                  </p>
                  <p className="text-xs text-zinc-500">vs</p>
                  <p className="font-semibold text-white">
                    {entryLabel(match.entry_two_id, entryById)}
                  </p>
                </div>

                {match.winner_entry_id ? (
                  <p className="mt-2 text-xs text-emerald-300">
                    Winner: {entryLabel(match.winner_entry_id, entryById)}
                  </p>
                ) : null}

                {match.room_code ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Room: {match.room_code}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
