import type { TournamentMatchRow } from "../../components/tournament/TournamentBracketPanel";
import type { TournamentEntryRow } from "../../components/tournament/TournamentListPanel";
import {
  canMatchBePlayed,
  getBracketSizeFromRoundOneMatchCount,
  getRoundLabel,
  getTotalRounds,
  isByeMatch,
} from "./bracket";
import { isTerminalMatchStatus, isWalkoverByeMatch } from "./matchDisplay";

/**
 * Returns the next round number the player is involved in (lowest non-terminal
 * round for this player), or null if there is no upcoming round.
 */
function getPlayerCurrentRound(
  myEntryId: string,
  matches: TournamentMatchRow[]
): number | null {
  let pendingRound: number | null = null;
  let latestTerminalRound: number | null = null;

  for (const match of matches) {
    if (!isParticipantMatch(match, myEntryId)) {
      continue;
    }

    if (!isTerminalMatchStatus(match.status)) {
      if (pendingRound === null || match.round_number < pendingRound) {
        pendingRound = match.round_number;
      }
    } else {
      if (
        latestTerminalRound === null ||
        match.round_number > latestTerminalRound
      ) {
        latestTerminalRound = match.round_number;
      }
    }
  }

  if (pendingRound !== null) {
    return pendingRound;
  }

  return latestTerminalRound;
}

export function getTournamentTotalRounds(
  matches: TournamentMatchRow[]
): number {
  const roundOne = matches.filter((match) => match.round_number === 1);
  if (roundOne.length === 0) {
    return 0;
  }
  try {
    return getTotalRounds(getBracketSizeFromRoundOneMatchCount(roundOne.length));
  } catch {
    return 0;
  }
}

export function getPlayerRoundLabel(
  myEntryId: string,
  matches: TournamentMatchRow[]
): string | null {
  const round = getPlayerCurrentRound(myEntryId, matches);
  const total = getTournamentTotalRounds(matches);
  if (!round || !total) {
    return null;
  }
  return getRoundLabel(round, total);
}

export type TournamentWaitingRoomState =
  | { kind: "hidden" }
  | {
      kind: "tournament_complete";
      championName: string | null;
      headline: string;
      detail?: string;
    }
  | { kind: "eliminated" }
  | {
      kind: "match_ready";
      showCountdown: boolean;
      countdownSeconds: number | null;
    }
  | { kind: "advanced_waiting" }
  | { kind: "bye_waiting" }
  | { kind: "join_match" };

function isParticipantMatch(
  match: TournamentMatchRow,
  myEntryId: string
): boolean {
  return (
    match.entry_one_id === myEntryId || match.entry_two_id === myEntryId
  );
}

function isEliminated(myEntryId: string, matches: TournamentMatchRow[]): boolean {
  for (const match of matches) {
    if (!isParticipantMatch(match, myEntryId)) {
      continue;
    }

    if (!isTerminalMatchStatus(match.status)) {
      continue;
    }

    if (!match.winner_entry_id) {
      continue;
    }

    if (match.winner_entry_id !== myEntryId) {
      return true;
    }
  }

  return false;
}

function getLatestParticipantMatch(
  myEntryId: string,
  matches: TournamentMatchRow[]
): TournamentMatchRow | null {
  const mine = matches.filter((match) => isParticipantMatch(match, myEntryId));

  if (mine.length === 0) {
    return null;
  }

  return [...mine].sort((a, b) => {
    if (b.round_number !== a.round_number) {
      return b.round_number - a.round_number;
    }
    return b.slot_index - a.slot_index;
  })[0];
}

export function deriveTournamentWaitingRoomState(options: {
  tournamentStatus: string;
  matches: TournamentMatchRow[];
  myEntry: TournamentEntryRow | null;
  championName: string | null;
  participantHeadline: string | null;
  participantDetail?: string;
  hasReadyMatch: boolean;
  hasJoinMatch: boolean;
  hasActivePlayableMatch: boolean;
  advancedByBye: boolean;
  pendingRealtimeReady: boolean;
}): TournamentWaitingRoomState {
  const {
    tournamentStatus,
    matches,
    myEntry,
    championName,
    participantHeadline,
    participantDetail,
    hasReadyMatch,
    hasJoinMatch,
    hasActivePlayableMatch,
    advancedByBye,
    pendingRealtimeReady,
  } = options;

  if (!myEntry || myEntry.status === "withdrawn") {
    return { kind: "hidden" };
  }

  const myEntryId = myEntry.id;

  if (tournamentStatus === "completed") {
    return {
      kind: "tournament_complete",
      championName,
      headline: participantHeadline ?? "Tournament complete",
      detail: participantDetail,
    };
  }

  if (tournamentStatus !== "in_progress") {
    return { kind: "hidden" };
  }

  if (isEliminated(myEntryId, matches)) {
    return { kind: "eliminated" };
  }

  if (pendingRealtimeReady || hasReadyMatch) {
    return {
      kind: "match_ready",
      showCountdown: pendingRealtimeReady,
      countdownSeconds: null,
    };
  }

  if (hasJoinMatch) {
    return { kind: "join_match" };
  }

  if (advancedByBye && !hasActivePlayableMatch) {
    return { kind: "bye_waiting" };
  }

  if (!hasActivePlayableMatch) {
    const latest = getLatestParticipantMatch(myEntryId, matches);

    if (latest) {
      const wonLatest =
        isTerminalMatchStatus(latest.status) &&
        latest.winner_entry_id === myEntryId;

      const waitingInOpenSlot =
        !isTerminalMatchStatus(latest.status) &&
        canMatchBePlayed(latest) &&
        !isByeMatch(latest.entry_one_id, latest.entry_two_id);

      const wonBye =
        isWalkoverByeMatch(
          latest.entry_one_id,
          latest.entry_two_id,
          latest.status
        ) && latest.winner_entry_id === myEntryId;

      if (wonLatest || waitingInOpenSlot || wonBye) {
        return { kind: "advanced_waiting" };
      }
    }

    const inFutureSlot = matches.some((match) => {
      if (!isParticipantMatch(match, myEntryId)) {
        return false;
      }
      return !isTerminalMatchStatus(match.status);
    });

    if (inFutureSlot) {
      return { kind: "advanced_waiting" };
    }
  }

  return { kind: "hidden" };
}
