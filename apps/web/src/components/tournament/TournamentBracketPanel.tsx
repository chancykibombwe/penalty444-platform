"use client";

import { useMemo } from "react";
import {
  canMatchBePlayed,
  getBracketSizeFromRoundOneMatchCount,
  getRoundLabel,
  getTotalRounds,
  isByeMatch,
  isPowerOfTwo,
  isVoidMatchStatus,
  nextPowerOfTwo,
} from "../../lib/tournament/bracket";
import { resolveChampionName } from "../../lib/tournament/champion";
import type { TournamentDetailRow } from "../../lib/tournament/useTournamentDetailSync";
import {
  bracketSectionClass,
  entryLabel,
  formatMatchStatus,
  getMatchSideDisplay,
  isTerminalMatchStatus,
  isWalkoverByeMatch,
  type MatchSideDisplay,
} from "../../lib/tournament/matchDisplay";
import type { TournamentEntryRow } from "./TournamentListPanel";
import TournamentMatchRoomAction from "./TournamentMatchRoomAction";

const BRACKET_STYLE = `
@keyframes bracketLivePulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.55), 0 0 22px rgba(34, 211, 238, 0.18);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(34, 211, 238, 0), 0 0 36px rgba(34, 211, 238, 0.32);
  }
}
.bracket-card-live {
  animation: bracketLivePulse 1.8s ease-in-out infinite;
}
@keyframes bracketLiveDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.7); }
}
.bracket-live-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: rgb(56 189 248);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.8);
  animation: bracketLiveDot 1s ease-in-out infinite;
}
@keyframes bracketWinShimmer {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
.bracket-winner-mark {
  animation: bracketWinShimmer 2.4s ease-in-out infinite;
}
@keyframes bracketWaitingDots {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1.05); }
}
.bracket-waiting-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
  margin-right: 3px;
  animation: bracketWaitingDots 1.2s ease-in-out infinite;
}
.bracket-waiting-dot:nth-child(2) { animation-delay: 0.18s; }
.bracket-waiting-dot:nth-child(3) { animation-delay: 0.36s; }
`;

type RoundTier = "final" | "semifinal" | "quarterfinal" | "early";

function getRoundTier(roundNumber: number, totalRounds: number): RoundTier {
  if (totalRounds <= 0) return "early";
  const fromFinal = totalRounds - roundNumber;
  if (fromFinal === 0) return "final";
  if (fromFinal === 1) return "semifinal";
  if (fromFinal === 2) return "quarterfinal";
  return "early";
}

function getRoundHeaderClasses(tier: RoundTier): string {
  switch (tier) {
    case "final":
      return "text-base font-black uppercase tracking-[0.28em] bg-gradient-to-r from-yellow-200 via-amber-200 to-yellow-300 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(234,179,8,0.35)]";
    case "semifinal":
      return "text-sm font-black uppercase tracking-[0.24em] text-amber-100";
    case "quarterfinal":
      return "text-sm font-bold uppercase tracking-[0.22em] text-amber-200/90";
    default:
      return "text-xs font-bold uppercase tracking-wider text-amber-200/80";
  }
}

function getRoundContextLabel(tier: RoundTier): string | null {
  switch (tier) {
    case "final":
      return "Championship decider";
    case "semifinal":
      return "One step from the final";
    case "quarterfinal":
      return "Last eight standing";
    default:
      return null;
  }
}

function getCardStateClasses(options: {
  status: string;
  isFinal: boolean;
  isSemifinal: boolean;
  isParticipant: boolean;
  isVoid: boolean;
  isWalkoverBye: boolean;
}): { className: string; live: boolean } {
  const classes: string[] = [
    "relative rounded-xl border px-4 py-3 transition-all duration-200",
  ];

  let live = false;

  switch (options.status) {
    case "in_progress":
      live = true;
      classes.push(
        "border-cyan-400/70 bg-gradient-to-br from-cyan-950/55 via-zinc-950 to-black ring-1 ring-cyan-400/40"
      );
      break;
    case "ready":
      classes.push(
        "border-amber-400/65 bg-gradient-to-br from-amber-950/45 via-zinc-950 to-black shadow-[0_0_20px_rgba(245,158,11,0.18)] ring-1 ring-amber-400/35"
      );
      break;
    case "completed":
      classes.push(
        "border-emerald-500/35 bg-gradient-to-br from-emerald-950/30 via-zinc-950 to-black"
      );
      break;
    case "walkover":
      classes.push(
        "border-emerald-500/25 bg-gradient-to-br from-emerald-950/20 via-zinc-950 to-zinc-950"
      );
      break;
    case "void":
      classes.push("border-zinc-600/45 bg-zinc-900/60");
      break;
    case "cancelled":
      classes.push("border-red-500/35 bg-red-950/20");
      break;
    case "pending":
      classes.push("border-dashed border-zinc-700 bg-zinc-950/40");
      break;
    default:
      classes.push("border-zinc-700/80 bg-zinc-950/50");
      break;
  }

  if (options.isFinal) {
    classes.push("md:min-w-[300px]");
    if (options.status === "completed" || options.status === "walkover") {
      classes.push(
        "border-yellow-300/55 ring-2 ring-yellow-300/35 shadow-[0_0_28px_rgba(234,179,8,0.25)]"
      );
    } else if (options.status === "in_progress") {
      classes.push("ring-2 ring-yellow-300/45");
    } else if (!options.isVoid) {
      classes.push("border-yellow-300/45 ring-1 ring-yellow-300/25");
    }
  } else if (options.isSemifinal && !options.isVoid) {
    classes.push("border-amber-300/35");
  }

  if (options.isParticipant) {
    classes.push("ring-2 ring-amber-400/75 shadow-lg shadow-amber-500/15");
  }

  if (live) {
    classes.push("bracket-card-live");
  }

  return { className: classes.join(" "), live };
}

function StateBadge({
  status,
  isFinal,
}: {
  status: string;
  isFinal: boolean;
}) {
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/60 bg-cyan-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
        <span className="bracket-live-dot" />
        Live
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-400/55 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-amber-100">
        Ready
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] ${
          isFinal
            ? "border-yellow-300/55 bg-yellow-500/15 text-yellow-100"
            : "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
        }`}
      >
        {isFinal ? "Champion" : "Completed"}
      </span>
    );
  }
  if (status === "walkover") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100/90">
        Walkover
      </span>
    );
  }
  if (status === "void") {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-500/45 bg-zinc-700/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-300">
        No winner
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-600/55 bg-zinc-800/50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
        Pending
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center rounded-full border border-red-400/50 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-red-100">
        Cancelled
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
      {formatMatchStatus(status)}
    </span>
  );
}

function SideRow({
  display,
  isWinner,
  isLive,
  isFinal,
}: {
  display: MatchSideDisplay;
  isWinner: boolean;
  isLive: boolean;
  isFinal: boolean;
}) {
  if (display.kind === "free_pass") {
    return (
      <div className="flex items-center justify-between rounded-md border border-zinc-700/70 bg-zinc-900/50 px-2.5 py-1.5">
        <span className="text-sm font-semibold text-zinc-300">Free Pass</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          Advances automatically
        </span>
      </div>
    );
  }

  if (display.kind === "waiting") {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-zinc-700 bg-zinc-950/40 px-2.5 py-1.5 text-zinc-400">
        <span className="inline-flex items-center text-sm font-semibold">
          <span className="bracket-waiting-dot" />
          <span className="bracket-waiting-dot" />
          <span className="bracket-waiting-dot" />
          <span className="ml-1">Waiting for winner</span>
        </span>
      </div>
    );
  }

  if (display.kind === "tbd") {
    return (
      <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5">
        <span className="text-sm font-semibold text-zinc-500">TBD</span>
      </div>
    );
  }

  const winnerClass = isWinner
    ? isFinal
      ? "border-yellow-300/55 bg-yellow-500/10 text-yellow-100 shadow-[0_0_18px_rgba(234,179,8,0.18)]"
      : "border-emerald-400/45 bg-emerald-500/10 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.18)]"
    : isLive
      ? "border-cyan-400/30 bg-cyan-950/20 text-white"
      : "border-zinc-700/70 bg-zinc-900/50 text-white";

  return (
    <div
      className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 transition-colors ${winnerClass}`}
    >
      <span className="truncate text-sm font-bold">{display.name}</span>
      {isWinner ? (
        <span
          className={`bracket-winner-mark inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider ${
            isFinal ? "text-yellow-200" : "text-emerald-200"
          }`}
          aria-label={isFinal ? "Champion" : "Advanced"}
        >
          <span aria-hidden>{isFinal ? "🏆" : "✓"}</span>
          {isFinal ? "Champion" : "Advanced"}
        </span>
      ) : null}
    </div>
  );
}

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

export type PlayerBracketState = {
  readyMatch: TournamentMatchRow | null;
  joinMatch: TournamentMatchRow | null;
  hasActivePlayableMatch: boolean;
  advancedByBye: boolean;
};

export function computePlayerBracketState(
  matches: TournamentMatchRow[],
  myEntryId: string | null,
  myEntryActive: boolean,
  tournamentInProgress: boolean
): PlayerBracketState {
  if (!myEntryId || !myEntryActive || !tournamentInProgress) {
    return {
      readyMatch: null,
      joinMatch: null,
      hasActivePlayableMatch: false,
      advancedByBye: false,
    };
  }

  let readyMatch: TournamentMatchRow | null = null;
  let joinMatch: TournamentMatchRow | null = null;
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

    if (canJoin && !joinMatch) {
      joinMatch = match;
    }

    if (
      isWalkoverByeMatch(match.entry_one_id, match.entry_two_id, match.status) &&
      match.winner_entry_id === myEntryId
    ) {
      advancedByBye = true;
    }
  }

  return { readyMatch, joinMatch, hasActivePlayableMatch, advancedByBye };
}

export type ParticipantTournamentResult = {
  headline: string;
  detail?: string;
};

export function computeParticipantTournamentResult(
  tournamentStatus: string,
  matches: TournamentMatchRow[],
  myEntryId: string | null,
  myEntryActive: boolean,
  championName: string | null
): ParticipantTournamentResult | null {
  if (tournamentStatus !== "completed" || !myEntryId || !myEntryActive) {
    return null;
  }

  if (matches.length === 0) {
    return null;
  }

  const maxRound = Math.max(...matches.map((match) => match.round_number));
  const finalMatch =
    matches
      .filter((match) => match.round_number === maxRound)
      .sort((a, b) => a.slot_index - b.slot_index)[0] ?? null;

  if (!finalMatch?.winner_entry_id) {
    return championName
      ? { headline: "Tournament complete", detail: `Champion: ${championName}` }
      : null;
  }

  if (finalMatch.winner_entry_id === myEntryId) {
    return {
      headline: "You are the champion",
      detail: "Congratulations — you won the tournament.",
    };
  }

  const playedFinal =
    finalMatch.entry_one_id === myEntryId ||
    finalMatch.entry_two_id === myEntryId;

  if (playedFinal) {
    return {
      headline: "Runner-up",
      detail: championName
        ? `Champion: ${championName}`
        : "Thanks for reaching the final.",
    };
  }

  return {
    headline: "Tournament complete",
    detail: championName ? `Champion: ${championName}` : undefined,
  };
}

type TournamentBracketPanelProps = {
  tournamentId: string;
  tournamentStatus: string;
  matches: TournamentMatchRow[];
  entries: TournamentEntryRow[];
  currentUserId: string | null;
  onUpdated?: () => void;
  prominent?: boolean;
  suppressWaitingBanners?: boolean;
  /**
   * When the real bracket hasn't been generated yet (registration / check_in),
   * use this to size the predicted bracket skeleton so empty slots are visible
   * immediately. Should be the tournament's `max_players`.
   */
  maxPlayers?: number;
};

function clampPredictedBracketSize(maxPlayers: number | undefined, registeredCount: number): number {
  if (registeredCount >= 2) {
    try {
      const sized = nextPowerOfTwo(Math.max(registeredCount, 2));
      if (maxPlayers && isPowerOfTwo(maxPlayers) && maxPlayers >= sized) {
        return maxPlayers;
      }
      return sized;
    } catch {
      // fall through
    }
  }
  if (maxPlayers && isPowerOfTwo(maxPlayers) && maxPlayers >= 2) {
    return maxPlayers;
  }
  return 0;
}

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
  suppressWaitingBanners = false,
  maxPlayers,
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

  const playerBracketState = useMemo(
    () =>
      computePlayerBracketState(
        matches,
        myEntryId,
        myEntryActive,
        tournamentInProgress
      ),
    [matches, myEntryId, myEntryActive, tournamentInProgress]
  );

  const championName = useMemo(() => {
    if (tournamentStatus !== "completed") {
      return null;
    }

    return resolveChampionName(
      { status: tournamentStatus, winner_id: null } as unknown as TournamentDetailRow,
      matches,
      entries
    );
  }, [tournamentStatus, matches, entries]);

  const participantResult = useMemo(
    () =>
      computeParticipantTournamentResult(
        tournamentStatus,
        matches,
        myEntryId,
        myEntryActive,
        championName
      ),
    [tournamentStatus, myEntryId, myEntryActive, matches, championName]
  );

  const sectionClass = bracketSectionClass(prominent, matches.length > 0);
  const titleClass = prominent
    ? "text-2xl font-bold text-white"
    : "text-xl font-bold text-white";

  if (matches.length === 0) {
    const activeEntries = entries.filter(
      (entry) => entry.status !== "withdrawn"
    );
    const predictedSize = clampPredictedBracketSize(
      maxPlayers,
      activeEntries.length
    );

    if (predictedSize >= 2) {
      return (
        <PrebuiltBracketSkeleton
          sectionClass={`${sectionClass} !p-4 sm:!p-5 md:!p-6 lg:!p-8`}
          titleClass={titleClass}
          predictedSize={predictedSize}
          entries={activeEntries}
          tournamentStatus={tournamentStatus}
        />
      );
    }

    return (
      <section className={`${sectionClass} !p-4 sm:!p-5 md:!p-6 lg:!p-8`}>
        <h2 className={titleClass}>Bracket</h2>
        <p className="mt-2 text-sm text-zinc-400">
          No matches yet. The bracket appears when the tournament starts at the
          scheduled time.
        </p>
      </section>
    );
  }

  const showReadyBanner =
    !suppressWaitingBanners && Boolean(playerBracketState.readyMatch);
  const showJoinBanner =
    !suppressWaitingBanners &&
    !showReadyBanner &&
    Boolean(playerBracketState.joinMatch);
  const showByeWaiting =
    !suppressWaitingBanners &&
    myEntryActive &&
    tournamentInProgress &&
    playerBracketState.advancedByBye &&
    !playerBracketState.hasActivePlayableMatch;
  const showWaitingForNext =
    !suppressWaitingBanners &&
    myEntryActive &&
    tournamentInProgress &&
    !playerBracketState.readyMatch &&
    !showByeWaiting &&
    !playerBracketState.hasActivePlayableMatch;

  return (
    <section
      id="tournament-bracket"
      className={`${sectionClass} !p-4 sm:!p-5 md:!p-6 lg:!p-8`}
    >
      <style dangerouslySetInnerHTML={{ __html: BRACKET_STYLE }} />
      <div>
        <h2 className={titleClass}>Bracket</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Single elimination · winners advance as matches finish
        </p>
      </div>

      {participantResult && !suppressWaitingBanners ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-4">
          <p className="text-lg font-bold text-emerald-100">
            {participantResult.headline}
          </p>
          {participantResult.detail ? (
            <p className="mt-1 text-sm text-emerald-100/80">
              {participantResult.detail}
            </p>
          ) : null}
        </div>
      ) : null}

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

      {showJoinBanner && playerBracketState.joinMatch ? (
        <div className="rounded-xl border-2 border-sky-400/50 bg-sky-950/50 px-4 py-4">
          <p className="text-lg font-bold text-sky-50">Rejoin your match</p>
          <p className="mt-1 text-sm text-sky-100/90">
            The match room is open — join before the deadline.
          </p>
          <div className="mt-3">
            <TournamentMatchRoomAction
              tournamentId={tournamentId}
              match={playerBracketState.joinMatch}
              isParticipant
              canEnterMatch={false}
              canJoinMatch
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
        <p className="rounded-lg border border-zinc-700/80 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300">
          Waiting for your next match.
        </p>
      ) : null}

      <div className="flex flex-col gap-6 md:-mx-2 md:flex-row md:items-start md:gap-5 md:overflow-x-auto md:px-2 md:pb-3">
        {rounds.map(({ roundNumber, matches: roundMatches }) => {
          const tier = getRoundTier(roundNumber, totalRounds);
          const isFinalRound = tier === "final";
          const isSemifinalRound = tier === "semifinal";
          const roundContext = getRoundContextLabel(tier);

          return (
            <div
              key={roundNumber}
              className={`flex flex-col gap-3 md:shrink-0 ${
                isFinalRound ? "md:min-w-[320px]" : "md:min-w-[280px]"
              }`}
            >
              <div>
                <h3 className={getRoundHeaderClasses(tier)}>
                  {getRoundLabel(roundNumber, totalRounds)}
                </h3>
                {roundContext ? (
                  <p
                    className={`mt-1 text-[10px] font-bold uppercase tracking-[0.2em] ${
                      isFinalRound
                        ? "text-yellow-300/80"
                        : isSemifinalRound
                          ? "text-amber-200/70"
                          : "text-amber-200/60"
                    }`}
                  >
                    {roundContext}
                  </p>
                ) : null}
              </div>

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
                  const isLive = match.status === "in_progress";
                  const isCompletedFinal =
                    isFinal &&
                    isTerminalMatchStatus(match.status) &&
                    Boolean(match.winner_entry_id);

                  const { className: cardClass } = getCardStateClasses({
                    status: match.status,
                    isFinal,
                    isSemifinal: isSemifinalRound,
                    isParticipant,
                    isVoid,
                    isWalkoverBye,
                  });

                  const sideOne = getMatchSideDisplay(match, 1, entryById);
                  const sideTwo = getMatchSideDisplay(match, 2, entryById);

                  return (
                    <li
                      key={match.id}
                      className={`${cardClass}${
                        isYourReadyMatch ? " ring-2 ring-amber-400/70" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {isFinal ? (
                            <span className="rounded-md border border-yellow-300/55 bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-yellow-100">
                              Final
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                              Match {match.slot_index + 1}
                            </span>
                          )}
                          {isParticipant ? (
                            <span className="rounded-md border border-amber-400/60 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-100">
                              Your Match
                            </span>
                          ) : null}
                        </div>
                        <StateBadge status={match.status} isFinal={isFinal} />
                      </div>

                      <div className="mt-3 space-y-1.5">
                        <SideRow
                          display={sideOne}
                          isWinner={
                            Boolean(match.winner_entry_id) &&
                            match.winner_entry_id === match.entry_one_id
                          }
                          isLive={isLive}
                          isFinal={isFinal}
                        />
                        <div className="flex items-center justify-center">
                          <span
                            className={`text-[10px] font-black uppercase tracking-[0.3em] ${
                              isLive ? "text-cyan-300/80" : "text-zinc-600"
                            }`}
                          >
                            vs
                          </span>
                        </div>
                        <SideRow
                          display={sideTwo}
                          isWinner={
                            Boolean(match.winner_entry_id) &&
                            match.winner_entry_id === match.entry_two_id
                          }
                          isLive={isLive}
                          isFinal={isFinal}
                        />
                      </div>

                      {isLive ? (
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-cyan-200/85">
                          Match in progress…
                        </p>
                      ) : null}

                      {isVoid ? (
                        <p className="mt-3 text-xs text-zinc-400">
                          Void — both players absent; no winner from this match.
                        </p>
                      ) : isWalkoverBye ? (
                        <p className="mt-3 text-xs text-emerald-200/80">
                          Advanced by Free Pass — no match required.
                        </p>
                      ) : isBye ? (
                        <p className="mt-3 text-xs text-zinc-500">
                          Free Pass — no match required for this slot.
                        </p>
                      ) : null}

                      {isCompletedFinal ? (
                        <p className="mt-3 text-xs font-black uppercase tracking-[0.22em] text-yellow-200/90">
                          🏆 Champion decided
                        </p>
                      ) : match.winner_entry_id && !isWalkoverBye ? (
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-300/85">
                          → {entryLabel(match.winner_entry_id, entryById)} advances
                        </p>
                      ) : null}

                      {match.status === "ready" &&
                      !match.room_code &&
                      playable &&
                      !isParticipant ? (
                        <p className="mt-3 text-xs text-amber-200/80">
                          Ready — waiting for players to enter match
                        </p>
                      ) : null}

                      {!isParticipant && actionUnavailableReason ? (
                        <p className="mt-3 text-xs text-zinc-500">
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

type PrebuiltBracketSkeletonProps = {
  sectionClass: string;
  titleClass: string;
  predictedSize: number;
  entries: TournamentEntryRow[];
  tournamentStatus: string;
};

/**
 * Visual skeleton bracket rendered before any matches exist in the DB.
 * Empty slots reveal the tournament structure during registration / check-in
 * so the lobby feels like a persistent arena. Filled slots show registered
 * players in join order — note the real seeding is decided at start time, so
 * this is illustrative only.
 */
function PrebuiltBracketSkeleton({
  sectionClass,
  titleClass,
  predictedSize,
  entries,
  tournamentStatus,
}: PrebuiltBracketSkeletonProps) {
  const totalRounds = getTotalRounds(predictedSize);
  const sortedEntries = [...entries].sort((a, b) => {
    const aTs = a.checked_in_at ? new Date(a.checked_in_at).getTime() : 0;
    const bTs = b.checked_in_at ? new Date(b.checked_in_at).getTime() : 0;
    return aTs - bTs;
  });

  const roundOneMatchCount = predictedSize / 2;
  const filledNames: (string | null)[] = [];
  for (let i = 0; i < predictedSize; i += 1) {
    filledNames[i] = sortedEntries[i]?.username ?? null;
  }

  const statusLabel =
    tournamentStatus === "check_in"
      ? "Starting soon"
      : tournamentStatus === "registration"
        ? "Registration open"
        : "Pre-tournament";

  return (
    <section id="tournament-bracket" className={sectionClass}>
      <style dangerouslySetInnerHTML={{ __html: BRACKET_STYLE }} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={titleClass}>Bracket preview</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {predictedSize}-slot bracket · fills as players join
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
          {statusLabel}
        </span>
      </div>

      <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/85">
        Seeding finalizes when the tournament starts. Open slots become Free
        Passes if the bracket isn't full.
      </p>

      <div className="mt-5 flex flex-col gap-6 md:-mx-2 md:flex-row md:items-start md:gap-5 md:overflow-x-auto md:px-2 md:pb-3">
        {Array.from({ length: totalRounds }).map((_, idx) => {
          const roundNumber = idx + 1;
          const matchCount = predictedSize / 2 ** roundNumber;
          const tier = getRoundTier(roundNumber, totalRounds);
          const isFinalRound = tier === "final";
          const isSemifinalRound = tier === "semifinal";
          const roundContext = getRoundContextLabel(tier);

          return (
            <div
              key={roundNumber}
              className={`flex flex-col gap-3 md:shrink-0 ${
                isFinalRound ? "md:min-w-[320px]" : "md:min-w-[280px]"
              }`}
            >
              <div>
                <h3 className={getRoundHeaderClasses(tier)}>
                  {getRoundLabel(roundNumber, totalRounds)}
                </h3>
                {roundContext ? (
                  <p
                    className={`mt-1 text-[10px] font-bold uppercase tracking-[0.2em] ${
                      isFinalRound
                        ? "text-yellow-300/80"
                        : isSemifinalRound
                          ? "text-amber-200/70"
                          : "text-amber-200/60"
                    }`}
                  >
                    {roundContext}
                  </p>
                ) : null}
              </div>

              <ul className="flex flex-col gap-3">
                {Array.from({ length: matchCount }).map((__, slotIndex) => {
                  const isRoundOne = roundNumber === 1;
                  const oneName = isRoundOne
                    ? filledNames[slotIndex * 2] ?? null
                    : null;
                  const twoName = isRoundOne
                    ? filledNames[slotIndex * 2 + 1] ?? null
                    : null;

                  return (
                    <li
                      key={`${roundNumber}-${slotIndex}`}
                      className={`relative rounded-xl border border-dashed bg-zinc-950/45 px-4 py-3 ${
                        isFinalRound
                          ? "border-yellow-300/35 md:min-w-[300px]"
                          : "border-zinc-700/70"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {isFinalRound ? (
                          <span className="rounded-md border border-yellow-300/45 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-yellow-100/80">
                            Final
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Match {slotIndex + 1}
                          </span>
                        )}
                        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                          Pending
                        </span>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        <SkeletonSlotRow name={oneName} isRoundOne={isRoundOne} />
                        <div className="flex items-center justify-center">
                          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600">
                            vs
                          </span>
                        </div>
                        <SkeletonSlotRow name={twoName} isRoundOne={isRoundOne} />
                      </div>
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

function SkeletonSlotRow({
  name,
  isRoundOne,
}: {
  name: string | null;
  isRoundOne: boolean;
}) {
  if (name) {
    return (
      <div className="flex items-center justify-between rounded-md border border-emerald-400/35 bg-emerald-500/5 px-2.5 py-1.5">
        <span className="truncate text-sm font-bold text-white">{name}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
          Registered
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-dashed border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-zinc-500">
      <span className="text-sm font-semibold">
        {isRoundOne ? "Open slot" : "Waiting for winner"}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">
        {isRoundOne ? "TBD" : "—"}
      </span>
    </div>
  );
}
