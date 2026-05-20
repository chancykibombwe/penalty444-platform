"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PendingMatchReady } from "../../lib/tournament/useTournamentRealtime";
import {
  getBracketSizeFromRoundOneMatchCount,
  getRoundLabel,
  getTotalRounds,
} from "../../lib/tournament/bracket";
import { saveTournamentMatchHandoff } from "../../lib/tournament/matchHandoff";
import {
  deriveTournamentWaitingRoomState,
  getPlayerRoundLabel,
} from "../../lib/tournament/playerWaitingRoom";
import type { TournamentMatchRow } from "./TournamentBracketPanel";
import type { TournamentEntryRow } from "./TournamentListPanel";
import TournamentMatchRoomAction from "./TournamentMatchRoomAction";

type TournamentWaitingRoomProps = {
  tournamentId: string;
  tournamentStatus: string;
  /** Display-only event name shown in match-ready / completion states. */
  tournamentName?: string | null;
  /** Display-only tier label (e.g. "Arena Cup") for event branding. */
  tournamentTierLabel?: string | null;
  matches: TournamentMatchRow[];
  myEntry: TournamentEntryRow | null;
  championName: string | null;
  participantHeadline: string | null;
  participantDetail?: string;
  readyMatch: TournamentMatchRow | null;
  joinMatch: TournamentMatchRow | null;
  hasActivePlayableMatch: boolean;
  advancedByBye: boolean;
  pendingMatchReady: PendingMatchReady | null;
  matchReadyCountdown: number | null;
  onEnterPendingMatch: () => void;
  onUpdated?: () => void;
};

const BRACKET_ANCHOR_ID = "tournament-bracket";

const PRIMARY_BUTTON_BASE =
  "inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black tracking-wide shadow-lg transition-all duration-200 sm:w-auto sm:px-6";
const SECONDARY_BUTTON_BASE =
  "inline-flex w-full items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-bold tracking-wide transition-colors sm:w-auto";

const PULSE_STYLE = `
@keyframes waitingRoomReadyPulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.55), 0 0 32px rgba(251, 191, 36, 0.18);
  }
  50% {
    box-shadow: 0 0 0 14px rgba(251, 191, 36, 0), 0 0 48px rgba(251, 191, 36, 0.32);
  }
}
.waiting-room-pulse {
  animation: waitingRoomReadyPulse 1.6s ease-in-out infinite;
}
@keyframes waitingRoomDot {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1.1); }
}
.waiting-room-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: currentColor;
  margin-right: 4px;
  animation: waitingRoomDot 1.2s ease-in-out infinite;
}
.waiting-room-dot:nth-child(2) { animation-delay: 0.18s; }
.waiting-room-dot:nth-child(3) { animation-delay: 0.36s; }
@keyframes waitingRoomTrophyShine {
  0% { transform: rotate(-4deg); }
  50% { transform: rotate(4deg); }
  100% { transform: rotate(-4deg); }
}
.waiting-room-trophy {
  display: inline-block;
  animation: waitingRoomTrophyShine 2.4s ease-in-out infinite;
}
`;

function StatusBadge({
  tone,
  label,
}: {
  tone: "amber" | "sky" | "emerald" | "red" | "gold";
  label: string;
}) {
  const toneClass = {
    amber:
      "border-amber-400/60 bg-amber-500/15 text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.18)]",
    sky: "border-sky-400/55 bg-sky-500/15 text-sky-100",
    emerald: "border-emerald-400/55 bg-emerald-500/15 text-emerald-200",
    red: "border-red-400/55 bg-red-500/15 text-red-200",
    gold: "border-yellow-300/65 bg-yellow-500/15 text-yellow-200 shadow-[0_0_24px_rgba(234,179,8,0.25)]",
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${toneClass}`}
    >
      {label}
    </span>
  );
}

function RoundChip({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">
      {label}
    </span>
  );
}

function WaitingDots({ tone }: { tone: string }) {
  return (
    <span className={`inline-flex items-center ${tone}`}>
      <span className="waiting-room-dot" />
      <span className="waiting-room-dot" />
      <span className="waiting-room-dot" />
    </span>
  );
}

export default function TournamentWaitingRoom({
  tournamentId,
  tournamentStatus,
  tournamentName = null,
  tournamentTierLabel = null,
  matches,
  myEntry,
  championName,
  participantHeadline,
  participantDetail,
  readyMatch,
  joinMatch,
  hasActivePlayableMatch,
  advancedByBye,
  pendingMatchReady,
  matchReadyCountdown,
  onEnterPendingMatch,
  onUpdated,
}: TournamentWaitingRoomProps) {
  const waitingState = useMemo(
    () =>
      deriveTournamentWaitingRoomState({
        tournamentStatus,
        matches,
        myEntry,
        championName,
        participantHeadline,
        participantDetail,
        hasReadyMatch: Boolean(readyMatch),
        hasJoinMatch: Boolean(joinMatch),
        hasActivePlayableMatch,
        advancedByBye,
        pendingRealtimeReady: Boolean(pendingMatchReady),
      }),
    [
      tournamentStatus,
      matches,
      myEntry,
      championName,
      participantHeadline,
      participantDetail,
      readyMatch,
      joinMatch,
      hasActivePlayableMatch,
      advancedByBye,
      pendingMatchReady,
    ]
  );

  const roundLabel = useMemo(
    () =>
      myEntry
        ? getPlayerRoundLabel(myEntry.id, matches)
        : null,
    [myEntry, matches]
  );

  const totalBracketRounds = useMemo(() => {
    const roundOneMatchCount = matches.filter(
      (match) => match.round_number === 1
    ).length;
    if (roundOneMatchCount <= 0) return 0;
    try {
      return getTotalRounds(
        getBracketSizeFromRoundOneMatchCount(roundOneMatchCount)
      );
    } catch {
      return 0;
    }
  }, [matches]);

  // Stage context for the player's NEXT match (used to escalate copy).
  const { nextRoundLabel, nextMatchIsFinal, isOtherSemifinalLive } = useMemo(() => {
    if (!myEntry) {
      return {
        nextRoundLabel: null as string | null,
        nextMatchIsFinal: false,
        isOtherSemifinalLive: false,
      };
    }
    if (totalBracketRounds <= 0) {
      return {
        nextRoundLabel: null as string | null,
        nextMatchIsFinal: false,
        isOtherSemifinalLive: false,
      };
    }

    let nextRound: number | null = null;
    let highestTerminalRound = 0;
    let highestTerminalWasWin = false;

    for (const match of matches) {
      const isMe =
        match.entry_one_id === myEntry.id || match.entry_two_id === myEntry.id;
      if (!isMe) continue;

      const isTerminal =
        match.status === "completed" ||
        match.status === "walkover" ||
        match.status === "void" ||
        match.status === "cancelled";

      if (!isTerminal) {
        if (nextRound === null || match.round_number < nextRound) {
          nextRound = match.round_number;
        }
      } else if (match.round_number > highestTerminalRound) {
        highestTerminalRound = match.round_number;
        highestTerminalWasWin = match.winner_entry_id === myEntry.id;
      }
    }

    // Player won the latest round and the next round is not yet seeded.
    if (
      nextRound === null &&
      highestTerminalWasWin &&
      highestTerminalRound > 0 &&
      highestTerminalRound < totalBracketRounds
    ) {
      nextRound = highestTerminalRound + 1;
    }

    const label =
      nextRound !== null
        ? getRoundLabel(nextRound, totalBracketRounds)
        : null;

    const isFinal = nextRound === totalBracketRounds;

    // "The other semifinal is still in progress." — only fires if I'm in/awaiting
    // the final and there's a live semifinal still in the bracket.
    const semiRound = totalBracketRounds - 1;
    const otherSemifinalLive =
      isFinal &&
      semiRound > 0 &&
      matches.some(
        (m) => m.round_number === semiRound && m.status === "in_progress"
      );

    return {
      nextRoundLabel: label,
      nextMatchIsFinal: isFinal,
      isOtherSemifinalLive: otherSemifinalLive,
    };
  }, [myEntry, matches, totalBracketRounds]);

  // Persist a small tournament-context handoff for the upcoming match room so
  // it can show a richer pre-match staging screen (Round label, Final flag).
  useEffect(() => {
    if (totalBracketRounds <= 0) return;

    const candidates: Array<TournamentMatchRow | null> = [
      readyMatch,
      joinMatch,
    ];

    if (pendingMatchReady) {
      const matchById = matches.find(
        (m) => m.id === pendingMatchReady.tournamentMatchId
      );
      if (matchById) candidates.push(matchById);
    }

    for (const match of candidates) {
      if (!match || !match.room_code) continue;
      const rLabel = getRoundLabel(match.round_number, totalBracketRounds);
      const isFinal = match.round_number === totalBracketRounds;
      saveTournamentMatchHandoff(match.room_code, {
        tournamentId,
        tournamentMatchId: match.id,
        roundLabel: rLabel,
        isFinal,
        opponentName: null,
      });
    }
  }, [
    matches,
    readyMatch,
    joinMatch,
    pendingMatchReady,
    totalBracketRounds,
    tournamentId,
  ]);

  if (waitingState.kind === "hidden") {
    return null;
  }

  const styleNode = (
    <style dangerouslySetInnerHTML={{ __html: PULSE_STYLE }} />
  );

  if (waitingState.kind === "tournament_complete") {
    const isChampion = waitingState.headline === "You are the champion";

    return (
      <>
        {styleNode}
        <section
          className={`relative overflow-hidden rounded-3xl border-2 px-5 py-6 sm:px-6 md:px-7 md:py-7 shadow-2xl ${
            isChampion
              ? "border-yellow-300/70 bg-gradient-to-br from-yellow-900/45 via-amber-950/70 to-black ring-2 ring-yellow-300/30 shadow-[0_0_56px_rgba(234,179,8,0.22)]"
              : "border-emerald-500/45 bg-gradient-to-br from-emerald-950/65 via-zinc-950 to-black shadow-[0_0_40px_rgba(16,185,129,0.18)]"
          }`}
          aria-label="Tournament result"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={isChampion ? "gold" : "emerald"}
              label={isChampion ? "Champion" : "Tournament finished"}
            />
            {isChampion ? (
              <span className="waiting-room-trophy text-2xl" aria-hidden>
                🏆
              </span>
            ) : null}
          </div>
          {tournamentName ? (
            <p
              className={`mt-3 text-[10px] font-black uppercase tracking-[0.28em] ${
                isChampion ? "text-yellow-200/85" : "text-emerald-200/80"
              }`}
            >
              {tournamentTierLabel
                ? `${tournamentTierLabel} · ${tournamentName}`
                : tournamentName}
            </p>
          ) : null}
          <h2
            className={`mt-1 break-words text-2xl font-black tracking-tight sm:text-3xl md:text-4xl ${
              isChampion ? "text-yellow-100" : "text-white"
            }`}
          >
            {waitingState.headline}
          </h2>
          {waitingState.championName ? (
            <p
              className={`mt-2 text-lg font-bold ${
                isChampion ? "text-yellow-200" : "text-emerald-100"
              }`}
            >
              Champion: {waitingState.championName}
            </p>
          ) : null}
          {waitingState.detail ? (
            <p className="mt-2 max-w-2xl text-sm text-zinc-300">
              {waitingState.detail}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap">
            <a
              href={`#${BRACKET_ANCHOR_ID}`}
              className={`${PRIMARY_BUTTON_BASE} ${
                isChampion
                  ? "bg-gradient-to-r from-yellow-300 to-amber-500 text-zinc-950 hover:from-yellow-200 hover:to-amber-400"
                  : "bg-gradient-to-r from-emerald-400 to-emerald-600 text-zinc-950 hover:from-emerald-300 hover:to-emerald-500"
              }`}
            >
              View Bracket
            </a>
            <Link
              href="/tournaments"
              className={`${SECONDARY_BUTTON_BASE} border-zinc-600 text-zinc-200 hover:border-zinc-400`}
            >
              Back to Tournaments
            </Link>
          </div>
        </section>
      </>
    );
  }

  if (waitingState.kind === "eliminated") {
    const championshipLive = matches.some(
      (m) =>
        totalBracketRounds > 0 &&
        m.round_number === totalBracketRounds &&
        m.status === "in_progress"
    );

    return (
      <>
        {styleNode}
        <section
          className="relative overflow-hidden rounded-3xl border-2 border-red-500/45 bg-gradient-to-br from-red-950/55 via-zinc-950 to-black px-5 py-6 sm:px-6 md:px-7 md:py-7 shadow-2xl shadow-red-950/30"
          aria-label="Eliminated"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="red" label="Eliminated" />
            <RoundChip label={roundLabel} />
            {championshipLive ? (
              <span className="inline-flex items-center rounded-full border border-yellow-300/55 bg-yellow-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-yellow-100">
                🏆 Final is live
              </span>
            ) : null}
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">
            You were eliminated
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-300">
            {championshipLive
              ? "Your run is over — the championship match is live below."
              : "You are out of this tournament. Good run — review the bracket to see how it finishes."}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap">
            <a
              href={`#${BRACKET_ANCHOR_ID}`}
              className={`${PRIMARY_BUTTON_BASE} bg-gradient-to-r from-zinc-200 to-zinc-400 text-zinc-950 hover:from-white hover:to-zinc-200`}
            >
              View Bracket
            </a>
            <Link
              href="/tournaments"
              className={`${SECONDARY_BUTTON_BASE} border-red-400/40 text-red-100 hover:border-red-300`}
            >
              Back to Tournaments
            </Link>
          </div>
        </section>
      </>
    );
  }

  if (waitingState.kind === "match_ready") {
    return (
      <MatchReadyBanner
        styleNode={styleNode}
        roundLabel={roundLabel}
        pendingMatchReady={pendingMatchReady}
        matchReadyCountdown={matchReadyCountdown}
        showCountdown={waitingState.showCountdown}
        onEnterPendingMatch={onEnterPendingMatch}
        readyMatch={readyMatch}
        tournamentId={tournamentId}
        onUpdated={onUpdated}
        isFinal={nextMatchIsFinal}
        tournamentName={tournamentName}
        tournamentTierLabel={tournamentTierLabel}
      />
    );
  }

  if (waitingState.kind === "join_match" && joinMatch) {
    return (
      <>
        {styleNode}
        <section
          className="relative overflow-hidden rounded-3xl border-2 border-sky-400/55 bg-gradient-to-br from-sky-950/70 via-zinc-950 to-black px-5 py-6 sm:px-6 md:px-7 md:py-7 shadow-2xl shadow-sky-950/30"
          aria-label="Rejoin match"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="sky" label="Match open" />
            <RoundChip label={roundLabel} />
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-sky-50 sm:text-3xl md:text-4xl">
            Rejoin your match
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-sky-100/90">
            Your match room is open — join before the deadline.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center">
            <TournamentMatchRoomAction
              tournamentId={tournamentId}
              match={joinMatch}
              isParticipant
              canEnterMatch={false}
              canJoinMatch
              onUpdated={onUpdated}
            />
            <a
              href={`#${BRACKET_ANCHOR_ID}`}
              className={`${SECONDARY_BUTTON_BASE} border-sky-400/45 text-sky-100 hover:border-sky-200`}
            >
              View Bracket
            </a>
          </div>
        </section>
      </>
    );
  }

  if (waitingState.kind === "bye_waiting") {
    return (
      <>
        {styleNode}
        <section
          className="relative overflow-hidden rounded-3xl border-2 border-emerald-400/45 bg-gradient-to-br from-emerald-950/55 via-zinc-950 to-black px-5 py-6 sm:px-6 md:px-7 md:py-7 shadow-2xl shadow-emerald-950/25"
          aria-label="Advanced by bye"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="emerald" label="Advanced" />
            <RoundChip label={roundLabel} />
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-emerald-50 sm:text-3xl md:text-4xl">
            You advanced automatically
          </h2>
          <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-emerald-100/90">
            <WaitingDots tone="text-emerald-200/80" />
            {nextMatchIsFinal
              ? "Championship match preparing."
              : nextRoundLabel
                ? `${nextRoundLabel} will start automatically.`
                : "Next match will start automatically."}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center">
            <a
              href={`#${BRACKET_ANCHOR_ID}`}
              className={`${PRIMARY_BUTTON_BASE} bg-gradient-to-r from-emerald-400 to-emerald-600 text-zinc-950 hover:from-emerald-300 hover:to-emerald-500`}
            >
              View Bracket
            </a>
            <Link
              href="/tournaments"
              className={`${SECONDARY_BUTTON_BASE} border-zinc-600 text-zinc-200 hover:border-zinc-400`}
            >
              Back to Tournaments
            </Link>
          </div>
        </section>
      </>
    );
  }

  if (waitingState.kind === "advanced_waiting") {
    const nextStageLower = nextRoundLabel
      ? nextRoundLabel.toLowerCase()
      : null;
    const headline = nextMatchIsFinal
      ? "Championship match preparing"
      : nextStageLower
        ? `Waiting for your ${nextStageLower} opponent`
        : "Waiting for your next opponent";
    const subline = nextMatchIsFinal
      ? isOtherSemifinalLive
        ? "The other semifinal is still in progress."
        : "Final match will start automatically once your opponent is ready."
      : "Next match will start automatically.";

    return (
      <>
        {styleNode}
        <section
          className={`relative overflow-hidden rounded-3xl border-2 px-5 py-6 sm:px-6 md:px-7 md:py-7 shadow-2xl ${
            nextMatchIsFinal
              ? "border-yellow-300/55 bg-gradient-to-br from-yellow-950/45 via-amber-950/30 to-black shadow-yellow-950/30"
              : "border-sky-400/45 bg-gradient-to-br from-sky-950/55 via-zinc-950 to-black shadow-sky-950/25"
          }`}
          aria-label="Waiting for next opponent"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={nextMatchIsFinal ? "gold" : "sky"}
              label={nextMatchIsFinal ? "🏆 Final preparing" : "You advanced"}
            />
            <RoundChip label={nextRoundLabel ?? roundLabel} />
          </div>
          <h2
            className={`mt-3 text-2xl font-black tracking-tight sm:text-3xl md:text-4xl ${
              nextMatchIsFinal ? "text-yellow-100" : "text-white"
            }`}
          >
            {headline}
          </h2>
          <p
            className={`mt-3 inline-flex items-center gap-2 text-sm font-semibold ${
              nextMatchIsFinal ? "text-yellow-100/90" : "text-sky-100/90"
            }`}
          >
            <WaitingDots
              tone={nextMatchIsFinal ? "text-yellow-200/80" : "text-sky-200/80"}
            />
            {subline}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Stay on this page — the bracket updates in real time. You can keep
            this tab open or come back later.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center">
            <a
              href={`#${BRACKET_ANCHOR_ID}`}
              className={`${PRIMARY_BUTTON_BASE} ${
                nextMatchIsFinal
                  ? "bg-gradient-to-r from-yellow-300 to-amber-500 text-zinc-950 hover:from-yellow-200 hover:to-amber-400"
                  : "bg-gradient-to-r from-sky-400 to-sky-600 text-zinc-950 hover:from-sky-300 hover:to-sky-500"
              }`}
            >
              View Bracket
            </a>
            <Link
              href="/tournaments"
              className={`${SECONDARY_BUTTON_BASE} border-zinc-600 text-zinc-200 hover:border-zinc-400`}
            >
              Back to Tournaments
            </Link>
          </div>
        </section>
      </>
    );
  }

  return null;
}

type MatchReadyBannerProps = {
  styleNode: React.ReactNode;
  roundLabel: string | null;
  pendingMatchReady: PendingMatchReady | null;
  matchReadyCountdown: number | null;
  showCountdown: boolean;
  onEnterPendingMatch: () => void;
  readyMatch: TournamentMatchRow | null;
  tournamentId: string;
  onUpdated?: () => void;
  isFinal?: boolean;
  tournamentName?: string | null;
  tournamentTierLabel?: string | null;
};

function MatchReadyBanner({
  styleNode,
  roundLabel,
  pendingMatchReady,
  matchReadyCountdown,
  showCountdown,
  onEnterPendingMatch,
  readyMatch,
  tournamentId,
  onUpdated,
  isFinal = false,
  tournamentName = null,
  tournamentTierLabel = null,
}: MatchReadyBannerProps) {
  const [isEntering, setIsEntering] = useState(false);

  // If the realtime payload is dropped (e.g. server replaces it), reset the
  // local "entering" state so the user can still see and use the bracket.
  useEffect(() => {
    if (!pendingMatchReady) {
      setIsEntering(false);
    }
  }, [pendingMatchReady]);

  const countdown =
    matchReadyCountdown ??
    (pendingMatchReady
      ? Math.max(1, Math.ceil(pendingMatchReady.autoRouteInMs / 1000))
      : null);

  // When the countdown reaches 0 or the user clicks Enter Now we render a
  // transient "Entering match room…" state to avoid the brief blank moment
  // before the match route mounts.
  const showEnteringState =
    isEntering || (pendingMatchReady !== null && countdown !== null && countdown <= 0);

  const handleEnterNow = () => {
    setIsEntering(true);
    onEnterPendingMatch();
  };

  return (
    <>
      {styleNode}
      <section
        className={`waiting-room-pulse relative overflow-hidden rounded-3xl border-2 px-5 py-6 sm:px-6 md:px-7 md:py-7 ${
          isFinal
            ? "border-yellow-300/75 bg-gradient-to-br from-yellow-900/55 via-amber-950/55 to-black shadow-[0_0_44px_rgba(234,179,8,0.28)]"
            : "border-amber-400/70 bg-gradient-to-br from-amber-900/55 via-orange-950/40 to-black"
        }`}
        aria-label="Next match ready"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={isFinal ? "gold" : "amber"}
            label={isFinal ? "🏆 Championship ready" : "Match ready"}
          />
          <RoundChip label={roundLabel} />
        </div>

        {tournamentName ? (
          <p
            className={`mt-3 text-[10px] font-black uppercase tracking-[0.28em] ${
              isFinal ? "text-yellow-200/85" : "text-amber-200/85"
            }`}
          >
            {tournamentTierLabel
              ? `${tournamentTierLabel} · ${tournamentName}`
              : tournamentName}
            {isFinal ? " · Final" : null}
          </p>
        ) : null}

        {showEnteringState ? (
          <>
            <h2
              className={`mt-3 text-2xl font-black tracking-tight sm:text-3xl md:text-4xl ${
                isFinal ? "text-yellow-100" : "text-amber-50"
              }`}
            >
              {isFinal
                ? "Entering championship match…"
                : "Entering match room…"}
            </h2>
            <p
              className={`mt-2 inline-flex items-center gap-3 text-sm font-semibold ${
                isFinal ? "text-yellow-100/90" : "text-amber-100/90"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 animate-spin rounded-full border-2 ${
                  isFinal
                    ? "border-yellow-300/40 border-t-yellow-200"
                    : "border-amber-300/40 border-t-amber-200"
                }`}
                aria-hidden
              />
              {isFinal
                ? "Loading the championship match."
                : "Loading your tournament match."}
            </p>
          </>
        ) : (
          <>
            <h2
              className={`mt-3 text-2xl font-black tracking-tight sm:text-3xl md:text-4xl ${
                isFinal ? "text-yellow-100" : "text-amber-50"
              }`}
            >
              {isFinal
                ? "Championship match is ready"
                : "Your next match is ready"}
            </h2>
            {showCountdown && countdown !== null ? (
              <p className="mt-3 inline-flex items-baseline gap-2 text-sm font-semibold text-amber-100/90">
                Entering match room in
                <span className="text-4xl font-black tabular-nums text-amber-100">
                  {countdown}s
                </span>
              </p>
            ) : (
              <p className="mt-2 max-w-2xl text-sm text-amber-100/90">
                Enter before the deadline to avoid forfeiting.
              </p>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center">
              {pendingMatchReady ? (
                <button
                  type="button"
                  onClick={handleEnterNow}
                  className={`${PRIMARY_BUTTON_BASE} bg-gradient-to-r from-amber-400 to-orange-500 text-zinc-950 hover:from-amber-300 hover:to-orange-400`}
                >
                  Enter Now →
                </button>
              ) : readyMatch ? (
                <TournamentMatchRoomAction
                  tournamentId={tournamentId}
                  match={readyMatch}
                  isParticipant
                  canEnterMatch
                  canJoinMatch={false}
                  onUpdated={onUpdated}
                />
              ) : null}
              <a
                href={`#${BRACKET_ANCHOR_ID}`}
                className={`${SECONDARY_BUTTON_BASE} border-amber-500/50 text-amber-100 hover:border-amber-300`}
              >
                View Bracket
              </a>
            </div>
          </>
        )}
      </section>
    </>
  );
}
