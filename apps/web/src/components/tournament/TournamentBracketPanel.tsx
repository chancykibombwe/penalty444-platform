"use client";

import { useMemo } from "react";
import { getRoundLabel, getTotalRounds } from "../../lib/tournament/bracket";
import {
  bracketSectionClass,
  entryLabel,
  formatMatchStatus,
  getMatchCardClasses,
  isTerminalMatchStatus,
} from "../../lib/tournament/matchDisplay";
import type { TournamentEntryRow } from "./TournamentListPanel";
import TournamentMatchRoomAction from "./TournamentMatchRoomAction";

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
  tournamentId: string;
  tournamentStatus: string;
  matches: TournamentMatchRow[];
  entries: TournamentEntryRow[];
  currentUserId: string | null;
  onUpdated?: () => void;
  prominent?: boolean;
};

export default function TournamentBracketPanel({
  tournamentId,
  tournamentStatus,
  matches,
  entries,
  currentUserId,
  onUpdated,
  prominent = false,
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

  const tournamentInProgress = tournamentStatus === "in_progress";

  const sectionClass = bracketSectionClass(prominent, matches.length > 0);
  const titleClass = prominent
    ? "text-2xl font-bold text-white"
    : "text-xl font-bold text-white";

  if (matches.length === 0) {
    return (
      <section className={sectionClass}>
        <h2 className={titleClass}>Bracket</h2>
        <p className="mt-2 text-sm text-zinc-400">
          No matches yet. The creator can start after the Ready Phase when the
          Ready player count is a power of two (2, 4, 8, …).
        </p>
      </section>
    );
  }

  return (
    <section className={sectionClass}>
      <div>
        <h2 className={titleClass}>Bracket</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Single elimination · winners advance as matches finish
        </p>
      </div>

      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-5 md:overflow-x-auto md:pb-2">
        {rounds.map(({ roundNumber, matches: roundMatches }) => {
          const isFinalRound =
            totalRounds > 0 && roundNumber === totalRounds;

          return (
            <div
              key={roundNumber}
              className="flex flex-col gap-3 md:min-w-[280px] md:shrink-0"
            >
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-200/90">
                {getRoundLabel(roundNumber, totalRounds)}
              </h3>

              <ul className="flex flex-col gap-3">
                {roundMatches.map((match) => {
                  const entryOne = match.entry_one_id
                    ? entryById.get(match.entry_one_id)
                    : null;
                  const entryTwo = match.entry_two_id
                    ? entryById.get(match.entry_two_id)
                    : null;

                  const isParticipant =
                    Boolean(currentUserId) &&
                    (entryOne?.user_id === currentUserId ||
                      entryTwo?.user_id === currentUserId);

                  const bothPlayersAssigned =
                    Boolean(match.entry_one_id) &&
                    Boolean(match.entry_two_id);

                  const canEnterMatch =
                    tournamentInProgress &&
                    bothPlayersAssigned &&
                    !match.winner_entry_id &&
                    !match.room_code &&
                    match.status === "ready";

                  const canJoinMatch =
                    tournamentInProgress &&
                    bothPlayersAssigned &&
                    !match.winner_entry_id &&
                    Boolean(match.room_code) &&
                    match.status === "in_progress" &&
                    !isTerminalMatchStatus(match.status);

                  const isFinal = isFinalRound;
                  const isCompletedFinal =
                    isFinal &&
                    isTerminalMatchStatus(match.status) &&
                    Boolean(match.winner_entry_id);

                  return (
                    <li
                      key={match.id}
                      className={getMatchCardClasses(match.status, {
                        isParticipant,
                        isFinal,
                      })}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {isFinal ? (
                            <span className="rounded-md border border-amber-500/50 bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-200">
                              Final
                            </span>
                          ) : (
                            <span className="text-xs uppercase tracking-wide text-zinc-500">
                              Slot {match.slot_index + 1}
                            </span>
                          )}
                          {isParticipant ? (
                            <span className="rounded-md border border-amber-400/60 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-100">
                              Your Match
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                          {formatMatchStatus(match.status)}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1 text-sm">
                        <p
                          className={`font-semibold ${
                            match.winner_entry_id === match.entry_one_id
                              ? "text-emerald-300"
                              : "text-white"
                          }`}
                        >
                          {entryLabel(match.entry_one_id, entryById)}
                        </p>
                        <p className="text-xs text-zinc-500">vs</p>
                        <p
                          className={`font-semibold ${
                            match.winner_entry_id === match.entry_two_id
                              ? "text-emerald-300"
                              : "text-white"
                          }`}
                        >
                          {entryLabel(match.entry_two_id, entryById)}
                        </p>
                      </div>

                      {isCompletedFinal ? (
                        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-300/90">
                          Champion decided
                        </p>
                      ) : match.winner_entry_id ? (
                        <p className="mt-2 text-xs text-emerald-400/80">
                          Winner:{" "}
                          {entryLabel(match.winner_entry_id, entryById)}
                        </p>
                      ) : null}

                      {match.status === "ready" &&
                      !match.room_code &&
                      bothPlayersAssigned &&
                      !isParticipant ? (
                        <p className="mt-2 text-xs text-amber-200/80">
                          Ready — waiting for players to enter match
                        </p>
                      ) : null}

                      <TournamentMatchRoomAction
                        tournamentId={tournamentId}
                        match={match}
                        isParticipant={isParticipant}
                        canEnterMatch={canEnterMatch}
                        canJoinMatch={canJoinMatch}
                        onUpdated={onUpdated}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
