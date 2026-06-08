import type { TournamentMatchRow } from "../../components/tournament/TournamentBracketPanel";
import type { TournamentEntryRow } from "../../components/tournament/TournamentListPanel";
import {
  getBracketSizeFromRoundOneMatchCount,
  getRoundLabel,
  getTotalRounds,
} from "./bracket";
import { isTerminalMatchStatus } from "./matchDisplay";

/**
 * Client-side derived presence for the current player in a tournament.
 * Phase 1 of the persistent lobby — no server state, no DB.
 */
export type TournamentPresence =
  | "VIEWING"
  | "WAITING"
  | "IN_MATCH"
  | "ELIMINATED"
  | "CHAMPION"
  | "RECONNECTING";

type DerivePresenceOptions = {
  tournamentStatus: string;
  myEntry: TournamentEntryRow | null;
  matches: TournamentMatchRow[];
  championUserId: string | null;
  currentUserId: string | null;
  /** True when the realtime socket is currently disconnected. */
  socketDisconnected?: boolean;
};

function isParticipantMatch(
  match: TournamentMatchRow,
  myEntryId: string
): boolean {
  return (
    match.entry_one_id === myEntryId || match.entry_two_id === myEntryId
  );
}

/**
 * Returns the current player's presence state in this tournament.
 * Pure function — no side effects, safe to call on every render.
 *
 * Priority order (top wins):
 *   1. CHAMPION   — tournament completed AND user is the champion
 *   2. ELIMINATED — tournament completed AND user is a non-champion participant
 *   3. VIEWING    — tournament completed/cancelled AND user is a spectator
 *   4. RECONNECTING — in_progress AND socket disconnected (participant only)
 *   5. IN_MATCH   — in_progress AND user has a non-terminal participant match
 *   6. ELIMINATED — in_progress AND user lost a participant match
 *   7. WAITING    — registration/check_in/in_progress, no other state applies
 *   8. VIEWING    — fallback (spectator, unknown state, …)
 */
export function derivePlayerPresence(
  options: DerivePresenceOptions
): TournamentPresence {
  const {
    tournamentStatus,
    myEntry,
    matches,
    championUserId,
    currentUserId,
    socketDisconnected = false,
  } = options;

  const isTerminalTournament =
    tournamentStatus === "completed" || tournamentStatus === "cancelled";

  // Terminal tournament states MUST resolve first so we never show
  // "IN_MATCH" on a finished/cancelled tournament.
  if (isTerminalTournament) {
    if (
      tournamentStatus === "completed" &&
      championUserId &&
      currentUserId &&
      championUserId === currentUserId
    ) {
      return "CHAMPION";
    }

    if (!myEntry || myEntry.status === "withdrawn") {
      return "VIEWING";
    }

    if (tournamentStatus === "completed") {
      // Tournament finished and the user wasn't the champion → eliminated.
      return "ELIMINATED";
    }

    // Cancelled tournament for a participant — fall back to viewing; the
    // tournament header will show the cancelled banner separately.
    return "VIEWING";
  }

  if (!myEntry || myEntry.status === "withdrawn") {
    return "VIEWING";
  }

  if (tournamentStatus !== "in_progress") {
    return "WAITING";
  }

  if (socketDisconnected) {
    return "RECONNECTING";
  }

  const myEntryId = myEntry.id;

  let hasActiveMatch = false;
  let isEliminated = false;

  for (const match of matches) {
    if (!isParticipantMatch(match, myEntryId)) continue;

    if (!isTerminalMatchStatus(match.status)) {
      hasActiveMatch = true;
    } else if (
      match.winner_entry_id &&
      match.winner_entry_id !== myEntryId
    ) {
      isEliminated = true;
    }
  }

  if (hasActiveMatch) {
    return "IN_MATCH";
  }

  if (isEliminated) {
    return "ELIMINATED";
  }

  return "WAITING";
}

export function getPresenceLabel(presence: TournamentPresence): string {
  switch (presence) {
    case "IN_MATCH":
      return "In match";
    case "WAITING":
      return "Waiting";
    case "ELIMINATED":
      return "Eliminated";
    case "CHAMPION":
      return "Champion";
    case "RECONNECTING":
      return "Reconnecting";
    case "VIEWING":
    default:
      return "Viewing";
  }
}

export function getPresenceExplanation(
  presence: TournamentPresence,
  options: {
    tournamentStatus?: string;
    hasReadyMatch?: boolean;
    /** e.g. "Quarterfinals", "Semifinals", "Final". */
    nextStageLabel?: string | null;
    /** True when the *player's* next match will be the final. */
    nextMatchIsFinal?: boolean;
    /** True when the championship match is currently live in the bracket. */
    championshipLive?: boolean;
  } = {}
): string {
  const {
    tournamentStatus,
    hasReadyMatch,
    nextStageLabel,
    nextMatchIsFinal,
    championshipLive,
  } = options;

  const stageLower = nextStageLabel ? nextStageLabel.toLowerCase() : null;

  switch (presence) {
    case "IN_MATCH":
      if (nextMatchIsFinal) {
        return hasReadyMatch
          ? "Championship match ready. Enter the match room."
          : "You are in the championship match.";
      }
      if (stageLower) {
        return hasReadyMatch
          ? `Your ${stageLower} match is ready. Enter the match room.`
          : `You are in a ${stageLower} match.`;
      }
      return hasReadyMatch
        ? "Your match is ready. Enter the match room."
        : "You are currently in a match.";
    case "WAITING":
      if (tournamentStatus === "registration") {
        return "You're in — waiting for the host to start the tournament.";
      }
      if (tournamentStatus === "check_in") {
        return "Ready phase open — mark yourself ready before kickoff.";
      }
      if (nextMatchIsFinal) {
        return "Championship match preparing — waiting for opponent.";
      }
      if (stageLower) {
        return `Waiting for your ${stageLower} opponent…`;
      }
      return "You are waiting for your next match.";
    case "ELIMINATED":
      if (tournamentStatus === "completed") {
        return "Tournament finished — you didn't take it this time.";
      }
      if (championshipLive) {
        return "You are out — the championship match is live.";
      }
      return "You are out of this tournament. Stay to watch the bracket finish.";
    case "CHAMPION":
      return "You won the tournament. Champion crowned.";
    case "RECONNECTING":
      return "Reconnecting to the live tournament…";
    case "VIEWING":
    default:
      if (tournamentStatus === "completed") {
        return "Spectating — tournament finished.";
      }
      if (tournamentStatus === "cancelled") {
        return "This tournament was cancelled.";
      }
      if (championshipLive) {
        return "Spectating — the championship match is live.";
      }
      return "You are watching this tournament as a spectator.";
  }
}

export function getPresenceToneClass(presence: TournamentPresence): string {
  switch (presence) {
    case "IN_MATCH":
      return "border-cyan-400/55 bg-cyan-500/15 text-cyan-100";
    case "WAITING":
      return "border-sky-400/50 bg-sky-500/10 text-sky-100";
    case "ELIMINATED":
      return "border-red-400/45 bg-red-500/10 text-red-100";
    case "CHAMPION":
      return "border-yellow-300/65 bg-yellow-500/15 text-yellow-100";
    case "RECONNECTING":
      return "border-amber-400/55 bg-amber-500/10 text-amber-100";
    case "VIEWING":
    default:
      return "border-zinc-500/45 bg-zinc-800/40 text-zinc-200";
  }
}

export type TournamentSummary = {
  registered: number;
  ready: number;
  /** Active participants still alive (not eliminated, not withdrawn). */
  remaining: number;
  matchesLive: number;
  matchesCompleted: number;
  matchesWaiting: number;
  /** All non-bye matches in the bracket. */
  matchesTotal: number;
  /** Earliest non-terminal round number in the bracket. */
  currentRoundNumber: number | null;
  currentRoundLabel: string | null;
  totalRounds: number;
};

/**
 * Pure summary of the current tournament state for display. Reads exactly
 * the same rows the bracket uses — no realtime channel.
 */
export function deriveTournamentSummary(options: {
  tournamentStatus: string;
  entries: TournamentEntryRow[];
  matches: TournamentMatchRow[];
}): TournamentSummary {
  const { tournamentStatus, entries, matches } = options;

  const activeEntries = entries.filter(
    (entry) => entry.status !== "withdrawn"
  );
  const registered = activeEntries.length;
  const ready = activeEntries.filter(
    (entry) => entry.status === "checked_in"
  ).length;

  const eliminatedEntryIds = new Set<string>();
  let matchesLive = 0;
  let matchesCompleted = 0;
  let matchesWaiting = 0;
  let matchesTotal = 0;
  let earliestNonTerminalRound: number | null = null;

  for (const match of matches) {
    matchesTotal += 1;

    if (match.status === "in_progress") {
      matchesLive += 1;
    } else if (isTerminalMatchStatus(match.status)) {
      matchesCompleted += 1;
      if (match.winner_entry_id) {
        if (
          match.entry_one_id &&
          match.entry_one_id !== match.winner_entry_id
        ) {
          eliminatedEntryIds.add(match.entry_one_id);
        }
        if (
          match.entry_two_id &&
          match.entry_two_id !== match.winner_entry_id
        ) {
          eliminatedEntryIds.add(match.entry_two_id);
        }
      }
    } else {
      matchesWaiting += 1;
    }

    if (!isTerminalMatchStatus(match.status)) {
      if (
        earliestNonTerminalRound === null ||
        match.round_number < earliestNonTerminalRound
      ) {
        earliestNonTerminalRound = match.round_number;
      }
    }
  }

  const remainingFromEliminations = activeEntries.filter(
    (entry) => !eliminatedEntryIds.has(entry.id)
  ).length;

  // Before the bracket is generated, "remaining" = registered.
  // After completion, force to 1 if we have a clear winner from matches.
  const remaining =
    matchesTotal === 0
      ? registered
      : tournamentStatus === "completed"
        ? Math.max(1, remainingFromEliminations)
        : remainingFromEliminations;

  const roundOneMatchCount = matches.filter(
    (match) => match.round_number === 1
  ).length;
  const totalRounds =
    roundOneMatchCount > 0
      ? (() => {
          try {
            return getTotalRounds(
              getBracketSizeFromRoundOneMatchCount(roundOneMatchCount)
            );
          } catch {
            return 0;
          }
        })()
      : 0;

  const currentRoundLabel =
    earliestNonTerminalRound !== null && totalRounds > 0
      ? getRoundLabel(earliestNonTerminalRound, totalRounds)
      : null;

  return {
    registered,
    ready,
    remaining,
    matchesLive,
    matchesCompleted,
    matchesWaiting,
    matchesTotal,
    currentRoundNumber: earliestNonTerminalRound,
    currentRoundLabel,
    totalRounds,
  };
}

/**
 * Tournament stage = where the bracket currently lives (Round 1, QF, SF, Final),
 * plus a few derived flags used to escalate visual atmosphere.
 *
 * Pure — same input always produces the same output.
 */
export type TournamentStageIntensity = "calm" | "rising" | "high" | "peak";

export type TournamentStage = {
  stageLabel: string;
  stageRoundNumber: number | null;
  totalRounds: number;
  isFinalRound: boolean;
  /** True when the bracket has a final match and any non-terminal match in it. */
  isFinalActive: boolean;
  /** True when the final match is completed (champion crowned). */
  isFinalDecided: boolean;
  /** True when only one (final) round of matches is yet to be resolved. */
  isLastFourReached: boolean;
  intensity: TournamentStageIntensity;
  /** 0–100 indicator of how many bracket matches have finished. */
  progressionPct: number;
};

export function deriveTournamentStage(options: {
  tournamentStatus: string;
  matches: TournamentMatchRow[];
  remainingPlayers: number;
}): TournamentStage {
  const { tournamentStatus, matches, remainingPlayers } = options;

  const roundOneMatchCount = matches.filter(
    (match) => match.round_number === 1
  ).length;

  let totalRounds = 0;
  if (roundOneMatchCount > 0) {
    try {
      totalRounds = getTotalRounds(
        getBracketSizeFromRoundOneMatchCount(roundOneMatchCount)
      );
    } catch {
      totalRounds = 0;
    }
  }

  let earliestNonTerminalRound: number | null = null;
  let latestTerminalRound = 0;
  let totalMatches = 0;
  let completedMatches = 0;
  let finalMatch: TournamentMatchRow | null = null;

  for (const match of matches) {
    totalMatches += 1;
    if (isTerminalMatchStatus(match.status)) {
      completedMatches += 1;
      if (match.round_number > latestTerminalRound) {
        latestTerminalRound = match.round_number;
      }
    } else if (
      earliestNonTerminalRound === null ||
      match.round_number < earliestNonTerminalRound
    ) {
      earliestNonTerminalRound = match.round_number;
    }

    if (totalRounds > 0 && match.round_number === totalRounds) {
      finalMatch = match;
    }
  }

  // Stage round = where most of the bracket attention is. Prefer the earliest
  // non-terminal round (matches still being played). Fall back to the latest
  // terminal round (everything completed).
  const stageRoundNumber =
    earliestNonTerminalRound ?? (latestTerminalRound > 0 ? latestTerminalRound : null);

  const stageLabel =
    stageRoundNumber !== null && totalRounds > 0
      ? getRoundLabel(stageRoundNumber, totalRounds)
      : tournamentStatus === "completed"
        ? "Tournament complete"
        : tournamentStatus === "in_progress"
          ? "Bracket live"
          : "Lobby";

  const isFinalRound =
    totalRounds > 0 && stageRoundNumber === totalRounds;

  const isFinalDecided = Boolean(
    finalMatch &&
      isTerminalMatchStatus(finalMatch.status) &&
      finalMatch.winner_entry_id
  );

  const isFinalActive = Boolean(
    finalMatch &&
      !isTerminalMatchStatus(finalMatch.status) &&
      (finalMatch.entry_one_id || finalMatch.entry_two_id)
  );

  // "Final four" reached = the semifinal round (totalRounds-1) has any
  // non-terminal matches OR the final round has any non-terminal matches.
  const isLastFourReached =
    totalRounds > 0 &&
    stageRoundNumber !== null &&
    stageRoundNumber >= totalRounds - 1;

  let intensity: TournamentStageIntensity = "calm";
  if (tournamentStatus === "completed" || isFinalActive || isFinalDecided) {
    intensity = "peak";
  } else if (isLastFourReached) {
    intensity = "high";
  } else if (
    totalRounds >= 3 &&
    stageRoundNumber !== null &&
    stageRoundNumber >= totalRounds - 2
  ) {
    intensity = "rising";
  }

  // 8-player tournament with 2 alive feels intense too even before final fires.
  if (intensity === "calm" && remainingPlayers > 0 && remainingPlayers <= 2) {
    intensity = "peak";
  }

  const progressionPct =
    totalMatches > 0
      ? Math.min(100, Math.round((completedMatches / totalMatches) * 100))
      : 0;

  return {
    stageLabel,
    stageRoundNumber,
    totalRounds,
    isFinalRound,
    isFinalActive,
    isFinalDecided,
    isLastFourReached,
    intensity,
    progressionPct,
  };
}

export function getStageBorderClass(intensity: TournamentStageIntensity): string {
  switch (intensity) {
    case "peak":
      return "border-yellow-300/55 bg-yellow-500/10 text-yellow-100 shadow-[0_0_28px_rgba(234,179,8,0.22)]";
    case "high":
      return "border-fuchsia-400/45 bg-fuchsia-500/10 text-fuchsia-100 shadow-[0_0_22px_rgba(217,70,239,0.18)]";
    case "rising":
      return "border-cyan-400/40 bg-cyan-500/10 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.16)]";
    case "calm":
    default:
      return "border-zinc-700 bg-zinc-900/60 text-zinc-200";
  }
}

export function getStageDotClass(intensity: TournamentStageIntensity): string {
  switch (intensity) {
    case "peak":
      return "bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.8)]";
    case "high":
      return "bg-fuchsia-400 shadow-[0_0_8px_rgba(217,70,239,0.7)]";
    case "rising":
      return "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.7)]";
    case "calm":
    default:
      return "bg-zinc-400";
  }
}
