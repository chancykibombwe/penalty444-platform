"use client";

import { useMemo } from "react";
import {
  canMatchBePlayed,
  getBracketSizeFromRoundOneMatchCount,
  getRoundLabel,
  getTotalRounds,
  isByeMatch,
  isVoidMatchStatus,
} from "../../lib/tournament/bracket";
import {
  bracketSectionClass,
  entryLabel,
  formatMatchStatus,
  getMatchCardClasses,
  isTerminalMatchStatus,
  isWalkoverByeMatch,
  matchEntrySideLabel,
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

function getParticipantActionReason(options: {
  isParticipant: boolean;
  tournamentInProgress: boolean;
  match: TournamentMatchRow;
  playable: boolean;
  canEnterMatch: boolean;
  canJoinMatch: boolean;
}): string | null {
  const {
    isParticipant,
    tournamentInProgress,
    match,
    playable,
    canEnterMatch,
    canJoinMatch,
  } = options;

  if (!isParticipant) {
    if (match.status === "ready" && playable && !match.room_code) {
      return "This is not your match.";
    }
    return null;
  }

  if (canEnterMatch || canJoinMatch) {
    return null;
  }

  if (!match.entry_one_id || !match.entry_two_id) {
    return "Waiting for opponent assignment.";
  }

  if (!tournamentInProgress) {
    return "Tournament has not started yet.";
  }

  if (isTerminalMatchStatus(match.status)) {
    return null;
  }

  if (!playable) {
    return null;
  }

  if (match.status === "in_progress" && match.room_code) {
    return "Match room is open — use Join Match when available.";
  }

  if (match.status === "pending") {
    return "Waiting for the previous round to finish.";
  }

  return "This match is not open for you yet.";
}

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

  const myEntry = useMemo(() => {
    if (!currentUserId) return null;
    return entries.find((entry) => entry.user_id === currentUserId) ?? null;
  }, [entries, currentUserId]);

  const myEntryId = myEntry?.id ?? null;
  const tournamentInProgress = tournamentStatus === "in_progress";
  const myEntryActive =
    myEntry != null && myEntry.status !== "withdrawn";

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
      ? getTotalRounds(getBracketSizeFromRoundOneMatchCount(roundOneMatchCount))
      : 0;

  const playerBracketState = useMemo(() => {
    if (!myEntryId || !myEntryActive || !tournamentInProgress) {
      return {
        readyMatch: null as TournamentMatchRow | null,
        hasActivePlayableMatch: false,
        advancedByBye: false,
      };
    }

    let readyMatch: TournamentMatchRow | null = null;
    let hasActivePlayableMatch = false;
    let advancedByBye = false;

    for (const match of matches) {
      const isParticipant =
        match.entry_one_id === myEntryId || match.entry_two_id === myEntryId;

      if (!isParticipant) continue;

      const playable = canMatchBePlayed(match);
      const canEnter =
        playable &&
        !match.winner_entry_id &&
        !match.room_code &&
        match.status === "ready";
      const canJoin =
        playable &&
        !match.winner_entry_id &&
        Boolean(match.room_code) &&
        match.status === "in_progress" &&
        !isTerminalMatchStatus(match.status);

      if (canEnter || canJoin) {
        hasActivePlayableMatch = true;
      }

      if (canEnter && !readyMatch) {
        readyMatch = match;
      }

      if (
        isWalkoverByeMatch(
          match.entry_one_id,
          match.entry_two_id,
          match.status
        ) &&
        match.winner_entry_id === myEntryId
      ) {
        advancedByBye = true;
      }
    }

    return { readyMatch, hasActivePlayableMatch, advancedByBye };
  }, [matches, myEntryId, myEntryActive, tournamentInProgress]);

  const sectionClass = bracketSectionClass(prominent, matches.length > 0);
  const titleClass = prominent
    ? "text-2xl font-bold text-white"
    : "text-xl font-bold text-white";

  if (matches.length === 0) {
    return (
      <section className={sectionClass}>
        <h2 className={titleClass}>Bracket</h2>
        <p className="mt-2 text-sm text-zinc-400">
          No matches yet. The bracket appears when the tournament starts at the
          scheduled time.
        </p>
      </section>
    );
  }

  const showReadyBanner = Boolean(playerBracketState.readyMatch);
  const showByeWaiting =
    myEntryActive &&
    tournamentInProgress &&
    playerBracketState.advancedByBye &&
    !playerBracketState.hasActivePlayableMatch;
  const showWaitingForNext =
    myEntryActive &&
    tournamentInProgress &&
    !playerBracketState.readyMatch &&
    !showByeWaiting &&
    !playerBracketState.hasActivePlayableMatch;

  return (
    <section className={sectionClass}>
      <div>
        <h2 className={titleClass}>Bracket</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Single elimination · winners advance as matches finish
        </p>
      </div>

      {showReadyBanner && playerBracketState.readyMatch ? (
        <div className="rounded-xl border-2 border-amber-400/60 bg-gradient-to-r from-amber-950/80 via-amber-900/30 to-zinc-950 px-4 py-4 shadow-lg shadow-amber-950/30">
          <p className="text-lg font-bold text-amber-50">Your match is ready</p>
          <p className="mt-1 text-sm text-amber-100/90">
            Enter before the deadline to avoid forfeiting.
          </p>
          <div className="mt-3">
            <TournamentMatchRoomAction
              tournamentId={tournamentId}
              match={playerBracketState.readyMatch}
              isParticipant
              canEnterMatch
              canJoinMatch={false}
              onUpdated={onUpdated}
            />
          </div>
        </div>
      ) : null}

      {showByeWaiting ? (
        <p className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
          You advanced automatically. Waiting for the next round.
        </p>
      ) : null}

      {showWaitingForNext ? (
        <p className="text-sm text-zinc-400">Waiting for your next match.</p>
      ) : null}

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

                  const playable = canMatchBePlayed(match);
                  const isVoid = isVoidMatchStatus(match.status);
                  const isWalkoverBye = isWalkoverByeMatch(
                    match.entry_one_id,
                    match.entry_two_id,
                    match.status
                  );
                  const isBye =
                    isWalkoverBye ||
                    isByeMatch(match.entry_one_id, match.entry_two_id);

                  const canEnterMatch =
                    tournamentInProgress &&
                    playable &&
                    !match.winner_entry_id &&
                    !match.room_code &&
                    match.status === "ready";

                  const canJoinMatch =
                    tournamentInProgress &&
                    playable &&
                    !match.winner_entry_id &&
                    Boolean(match.room_code) &&
                    match.status === "in_progress" &&
                    !isTerminalMatchStatus(match.status);

                  const isYourReadyMatch =
                    playerBracketState.readyMatch?.id === match.id;

                  const actionUnavailableReason = getParticipantActionReason({
                    isParticipant,
                    tournamentInProgress,
                    match,
                    playable,
                    canEnterMatch,
                    canJoinMatch,
                  });

                  const isFinal = isFinalRound;
                  const isCompletedFinal =
                    isFinal &&
                    isTerminalMatchStatus(match.status) &&
                    Boolean(match.winner_entry_id);

                  return (
                    <li
                      key={match.id}
                      className={`${getMatchCardClasses(match.status, {
                        isParticipant,
                        isFinal,
                      })}${isYourReadyMatch ? " ring-2 ring-amber-400/70" : ""}`}
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
                          {matchEntrySideLabel(
                            match.entry_one_id,
                            match.entry_two_id,
                            entryById,
                            1
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">vs</p>
                        <p
                          className={`font-semibold ${
                            match.winner_entry_id === match.entry_two_id
                              ? "text-emerald-300"
                              : "text-white"
                          }`}
                        >
                          {matchEntrySideLabel(
                            match.entry_one_id,
                            match.entry_two_id,
                            entryById,
                            2
                          )}
                        </p>
                      </div>

                      {isVoid ? (
                        <p className="mt-2 text-xs text-zinc-400">
                          Void — both players absent; no winner from this match.
                        </p>
                      ) : isWalkoverBye ? (
                        <p className="mt-2 text-xs text-zinc-500">
                          Advanced by Free Pass — no match required.
                        </p>
                      ) : isBye ? (
                        <p className="mt-2 text-xs text-zinc-500">
                          Free Pass — no match required for this slot.
                        </p>
                      ) : null}

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
                      playable &&
                      !isParticipant ? (
                        <p className="mt-2 text-xs text-amber-200/80">
                          Ready — waiting for players to enter match
                        </p>
                      ) : null}

                      {!isParticipant && actionUnavailableReason ? (
                        <p className="mt-2 text-xs text-zinc-500">
                          {actionUnavailableReason}
                        </p>
                      ) : null}

                      <TournamentMatchRoomAction
                        tournamentId={tournamentId}
                        match={match}
                        isParticipant={isParticipant}
                        canEnterMatch={canEnterMatch}
                        canJoinMatch={canJoinMatch}
                        actionUnavailableReason={actionUnavailableReason}
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


