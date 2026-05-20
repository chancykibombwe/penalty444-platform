"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { PendingMatchReady } from "../../lib/tournament/useTournamentRealtime";
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
  "inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-black tracking-wide shadow-lg transition-all duration-200";
const SECONDARY_BUTTON_BASE =
  "inline-flex items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-bold tracking-wide transition-colors";

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
          className={`relative overflow-hidden rounded-3xl border-2 px-7 py-7 shadow-2xl ${
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
          <h2
            className={`mt-3 text-3xl font-black tracking-tight md:text-4xl ${
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
          <div className="mt-6 flex flex-wrap gap-3">
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
    return (
      <>
        {styleNode}
        <section
          className="relative overflow-hidden rounded-3xl border-2 border-red-500/45 bg-gradient-to-br from-red-950/55 via-zinc-950 to-black px-7 py-7 shadow-2xl shadow-red-950/30"
          aria-label="Eliminated"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="red" label="Eliminated" />
            <RoundChip label={roundLabel} />
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-4xl">
            You were eliminated
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-300">
            You are out of this tournament. Good run — review the bracket to
            see how it finishes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
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
    const countdown =
      matchReadyCountdown ??
      (pendingMatchReady
        ? Math.max(1, Math.ceil(pendingMatchReady.autoRouteInMs / 1000))
        : null);

    return (
      <>
        {styleNode}
        <section
          className="waiting-room-pulse relative overflow-hidden rounded-3xl border-2 border-amber-400/70 bg-gradient-to-br from-amber-900/55 via-orange-950/40 to-black px-7 py-7"
          aria-label="Next match ready"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="amber" label="Match ready" />
            <RoundChip label={roundLabel} />
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-amber-50 md:text-4xl">
            Your next match is ready
          </h2>
          {waitingState.showCountdown && countdown !== null ? (
            <p className="mt-3 inline-flex items-baseline gap-2 text-sm font-semibold text-amber-100/90">
              Entering the match room in
              <span className="text-2xl font-black tabular-nums text-amber-100">
                {countdown}s
              </span>
            </p>
          ) : (
            <p className="mt-2 max-w-2xl text-sm text-amber-100/90">
              Enter before the deadline to avoid forfeiting.
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {pendingMatchReady ? (
              <button
                type="button"
                onClick={onEnterPendingMatch}
                className={`${PRIMARY_BUTTON_BASE} bg-gradient-to-r from-amber-400 to-orange-500 text-zinc-950 hover:from-amber-300 hover:to-orange-400`}
              >
                Enter Now →
              </button>
            ) : null}
            {readyMatch ? (
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
        </section>
      </>
    );
  }

  if (waitingState.kind === "join_match" && joinMatch) {
    return (
      <>
        {styleNode}
        <section
          className="relative overflow-hidden rounded-3xl border-2 border-sky-400/55 bg-gradient-to-br from-sky-950/70 via-zinc-950 to-black px-7 py-7 shadow-2xl shadow-sky-950/30"
          aria-label="Rejoin match"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="sky" label="Match open" />
            <RoundChip label={roundLabel} />
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-sky-50 md:text-4xl">
            Rejoin your match
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-sky-100/90">
            Your match room is open — join before the deadline.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
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
          className="relative overflow-hidden rounded-3xl border-2 border-emerald-400/45 bg-gradient-to-br from-emerald-950/55 via-zinc-950 to-black px-7 py-7 shadow-2xl shadow-emerald-950/25"
          aria-label="Advanced by bye"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="emerald" label="Advanced" />
            <RoundChip label={roundLabel} />
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-emerald-50 md:text-4xl">
            You advanced automatically
          </h2>
          <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-emerald-100/90">
            <WaitingDots tone="text-emerald-200/80" />
            Next match will start automatically.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
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
    return (
      <>
        {styleNode}
        <section
          className="relative overflow-hidden rounded-3xl border-2 border-sky-400/45 bg-gradient-to-br from-sky-950/55 via-zinc-950 to-black px-7 py-7 shadow-2xl shadow-sky-950/25"
          aria-label="Waiting for next opponent"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="sky" label="You advanced" />
            <RoundChip label={roundLabel} />
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-4xl">
            Waiting for your next opponent
          </h2>
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-sky-100/90">
            <WaitingDots tone="text-sky-200/80" />
            Next match will start automatically.
          </p>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Stay on this page — the bracket updates in real time. You can keep
            this tab open or come back later.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href={`#${BRACKET_ANCHOR_ID}`}
              className={`${PRIMARY_BUTTON_BASE} bg-gradient-to-r from-sky-400 to-sky-600 text-zinc-950 hover:from-sky-300 hover:to-sky-500`}
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
