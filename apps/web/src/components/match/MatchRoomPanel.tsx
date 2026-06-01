"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSocket, isSocketEventForRoom } from "../../lib/socket/client";
import {
  clearActiveMatch,
  clearActiveMatchIfPlayerMismatch,
  saveActiveMatch,
} from "../../lib/match/activeMatch";
import {
  getCurrentPlayerIdentity,
  type PlayerIdentity,
} from "../../lib/auth/playerIdentity";
import {
  clearTournamentMatchHandoff,
  readTournamentMatchHandoff,
  type TournamentMatchHandoff,
} from "../../lib/tournament/matchHandoff";
import MatchAtmosphereLayer from "./MatchAtmosphereLayer";
import MatchStagingScreen from "./MatchStagingScreen";
import MatchResultOverlay from "./MatchResultOverlay";
import MatchScoreboard from "./MatchScoreboard";
import RoundTransition, {
  type RoundTransitionKind,
} from "./RoundTransition";
import {
  accentForContext,
  classifyRoundTransition,
  getPostMatchPresentation,
  isValidLane,
  laneEmoji,
  LANES,
  MATCH_PRESENTATION_CSS,
  MATCH_REVEAL_HOLD_CASUAL_MS,
  MATCH_REVEAL_HOLD_TOURNAMENT_MS,
  MATCH_STAGING_SECONDS_TOURNAMENT,
  MATCH_TENSION_CASUAL_MS,
  MATCH_TENSION_TOURNAMENT_MS,
  pickResultFlavorMessage,
  RESULT_OVERLAY_VISIBLE_MS,
  resultBackgroundClass as resultStyle,
  resultEmoji,
  resultHeadlineClass,
  resultLabel,
  resultSubheadline,
  ROUND_TRANSITION_VISIBLE_MS,
  type Lane,
  type MatchPhase,
  type RevealStage,
  type Role,
  type ShotResult,
} from "./matchPresentation";

type MatchResultPayload = {
  roomCode?: string;
  code?: string;
  round?: number;
  kickerPlayerId?: string | null;
  keeperPlayerId?: string | null;
  kickerPick: Lane | null;
  keeperPick: Lane | null;
  result: ShotResult;
  statusMessage?: string;
};

type MatchType =
  | "private"
  | "public"
  | "ranked"
  | "tournament"
  | "unknown";

type MatchUpdatePayload = {
  roomCode?: string;
  code?: string;
  roles: Record<string, Role>;
  kickerPlayerId?: string | null;
  keeperPlayerId?: string | null;
  playerNames?: Record<string, string>;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  matchEnded?: boolean;
  phase?: MatchPhase;
  suddenDeathRound?: number;
  suddenRound?: number;
  matchStartedAt?: number;
  earlyCancelDeadlineAt?: number;
  matchInstance?: number;
  matchType?: MatchType;
  tournamentId?: string;
  // Booleans-only lock map. Lane data is never broadcast here. Used by the
  // client to render "Opponent locked" / "Both players locked" status after
  // a refresh without exposing the opponent's chosen lane.
  picksLocked?: { KICKER?: boolean; KEEPER?: boolean };
  isResolving?: boolean;
};

type MatchRejoinStatePayload = {
  roomCode?: string;
  myRole?: Role | null;
  myPick?: Lane | null;
  opponentHasLocked?: boolean;
  round?: number;
  phase?: MatchPhase;
  suddenDeathRound?: number;
  matchInstance?: number;
  matchEnded?: boolean;
  isResolving?: boolean;
  disconnectGrace?: {
    active: boolean;
    disconnectedPlayerId?: string;
    expiresAt?: number;
  };
};

type MatchEndPayload = {
  scores: Record<string, number>;
  tournamentId?: string;
};

/**
 * Pre-reveal tension window. Server timing is unchanged — this is just how
 * long the client lingers in the REVEALING stage before showing the result.
 * Tournament: long enough for the 3-2-1 ticker; casual: brief sync flash.
 */
const MATCH_RESULT_REVEAL_MS = MATCH_TENSION_CASUAL_MS;
const TOURNAMENT_MATCH_RESULT_REVEAL_MS = MATCH_TENSION_TOURNAMENT_MS;
/**
 * Minimum time the result stays visible on screen before the client allows
 * the next round's `match:update` to clear it. The server still resolves
 * on its own schedule (RESULT_REVEAL_PAUSE_MS = 3000ms); this is purely
 * client-side dramatic hold so players don't get yanked into the next
 * round in <500ms. Casual gets a shorter hold (~1500ms) so the combined
 * tension+reveal window stays under ~5s end-to-end; tournament uses a
 * longer hold for the dramatic cinematic.
 */
const CASUAL_REVEAL_HOLD_MS = MATCH_REVEAL_HOLD_CASUAL_MS;
const TOURNAMENT_REVEAL_HOLD_MS = MATCH_REVEAL_HOLD_TOURNAMENT_MS;
const TOURNAMENT_POST_MATCH_REDIRECT_MS = 4500;

type MatchAbortedPayload = {
  roomCode?: string;
  abortedBy?: string;
  matchInstance?: number;
  reason?: string;
};

type RematchUpdatePayload = {
  votes: number;
  required: number;
  lastRequesterId?: string | null;
};

type RematchDeclinedPayload = {
  declinedBy: string;
};

type MatchStatusPayload = {
  roomCode?: string;
  code?: string;
  message: string;
  timeoutSeconds?: number;
  phase?: MatchPhase;
  suddenDeathRound?: number;
  suddenRound?: number;
  // Authoritative forfeit-grace expiry carried by the server's
  // "Opponent disconnected. Waiting 39 seconds for reconnect..."
  // status. Used to resume the abort countdown from the true remaining
  // time and to know whether grace is still live.
  expiresAt?: number;
};

function getLaneButtonClass(
  lane: Lane,
  options: {
    canPick: boolean;
    myPick: Lane | null;
    isSuddenDeath: boolean;
    revealStage: RevealStage;
  }
) {
  const { canPick, myPick, isSuddenDeath, revealStage } = options;
  const isSelected = myPick === lane;
  const isLocked = myPick !== null;
  const isRevealLocked =
    revealStage === "REVEALING" || revealStage === "REVEALED";

  if (isSelected) {
    return "match-lane-locked scale-[1.03] border-emerald-300 bg-emerald-500/20 text-emerald-50 shadow-[0_0_28px_rgba(52,211,153,0.35)] ring-2 ring-emerald-300/70";
  }

  if (!canPick || isRevealLocked) {
    return "match-lane-disabled cursor-not-allowed border-zinc-800/80 bg-black/20 text-zinc-600 opacity-45";
  }

  if (isLocked) {
    return "match-lane-muted cursor-not-allowed border-zinc-800 bg-black/25 text-zinc-500 opacity-60";
  }

  if (isSuddenDeath) {
    return "match-lane-ready border-yellow-500/70 bg-black/35 text-yellow-50 hover:-translate-y-0.5 hover:border-yellow-300 hover:bg-yellow-400 hover:text-black active:scale-[0.98]";
  }

  return "match-lane-ready border-zinc-700 bg-black/35 text-white hover:-translate-y-0.5 hover:border-white hover:bg-white hover:text-black active:scale-[0.98]";
}

function normalizeAuthoritativeResult(
  data: MatchResultPayload
): MatchResultPayload | null {
  if (data.result !== "GOAL" && data.result !== "SAVE" && data.result !== "DRAW") {
    return null;
  }

  return {
    round: data.round,
    kickerPlayerId: data.kickerPlayerId ?? null,
    keeperPlayerId: data.keeperPlayerId ?? null,
    kickerPick: data.kickerPick ?? null,
    keeperPick: data.keeperPick ?? null,
    result: data.result,
    statusMessage: data.statusMessage,
  };
}

function assertAuthoritativeResultIntegrity(payload: MatchResultPayload): void {
  if (process.env.NODE_ENV !== "development") return;
  if (!payload.kickerPick || !payload.keeperPick) return;

  const inferred: ShotResult =
    payload.kickerPick === payload.keeperPick ? "SAVE" : "GOAL";

  if (inferred !== payload.result && payload.result !== "DRAW") {
    console.warn("[match:result] payload integrity mismatch", payload);
  }
}

function isResultRoundAcceptable(
  resultRound: number | undefined,
  expectedRound: number | null,
  lateRound: number | null
): boolean {
  if (resultRound === undefined) {
    return true;
  }

  if (expectedRound === null) {
    return true;
  }

  if (resultRound === expectedRound) {
    return true;
  }

  return lateRound !== null && resultRound === lateRound;
}

function applyAuthoritativeRoles(
  payload: {
    roles: Record<string, Role>;
    kickerPlayerId?: string | null;
    keeperPlayerId?: string | null;
  },
  myPlayerId: string
): Record<string, Role> {
  const nextRoles = { ...payload.roles };

  if (payload.kickerPlayerId) {
    nextRoles[payload.kickerPlayerId] = "KICKER";
  }

  if (payload.keeperPlayerId) {
    nextRoles[payload.keeperPlayerId] = "KEEPER";
  }

  const roleValues = Object.values(nextRoles);
  const kickerCount = roleValues.filter((role) => role === "KICKER").length;
  const keeperCount = roleValues.filter((role) => role === "KEEPER").length;

  if (kickerCount !== 1 || keeperCount !== 1) {
    console.warn("[match:roles] invalid role map from server", {
      roles: payload.roles,
      kickerPlayerId: payload.kickerPlayerId,
      keeperPlayerId: payload.keeperPlayerId,
      myPlayerId,
      kickerCount,
      keeperCount,
    });
  }

  return nextRoles;
}

function isReconnectForfeitCountdownStatusMessage(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("opponent disconnected") &&
    lower.includes("waiting") &&
    lower.includes("39") &&
    lower.includes("second") &&
    lower.includes("reconnect")
  );
}

/**
 * Pre-start waiting card — rendered when the creator is alone in the
 * room (playerCount < 2, match not yet started). Designed to be
 * NON-TRAPPING: explicit copy that the user can navigate away, plus
 * Copy / native-share buttons and a direct "Back to Lobby" link.
 *
 * The wrapping overlay (`fixed inset-0 z-40`) is intentionally kept
 * BELOW the Navbar (`z-50` after this PR), so the user can also use
 * the app's tab bar to move around freely while we hold the room.
 *
 * Server-side: `MatchRoomPanel`'s cleanup emits `player:leave`, which
 * flips presence false. If an opponent later joins, the readiness
 * authority emits `match:opponentReady` to the creator's lobby
 * socket → `MatchReadyNotification` shows the "Join match" modal.
 * If the creator never returns, the readiness authority cancels the
 * room cleanly with no penalty (see `cancelRoomDueToNoReturn`).
 */
function WaitingForOpponentCard({ roomCode }: { roomCode: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(
      typeof navigator !== "undefined" &&
        typeof navigator.share === "function"
    );
  }, []);

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(roomCode);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // Clipboard can be blocked by permissions or insecure context;
      // the code itself is `select-all` so users can still copy it
      // manually.
    }
  }

  async function handleShare() {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      return;
    }
    try {
      await navigator.share({
        title: "444 ARENA — match invite",
        text: `Join my Penalty444 match. Room code: ${roomCode}`,
      });
    } catch {
      // User cancelled the share sheet; no-op.
    }
  }

  return (
    <>
      <p className="text-xs font-black uppercase tracking-[0.32em] text-zinc-400">
        Waiting for opponent
      </p>
      <p className="mt-3 text-sm text-zinc-300">
        Share your room code to start the match.
      </p>
      <p className="mt-4 select-all text-3xl font-black tracking-[0.4em] text-white">
        {roomCode}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-white transition hover:bg-white/15"
        >
          {copied ? "Copied" : "Copy code"}
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-cyan-100 transition hover:bg-cyan-500/25"
          >
            Share
          </button>
        ) : null}
      </div>

      {/* Anti-trap messaging. Pairs with the lifted-z Navbar so the
          creator has two clear ways to leave: the app tabs OR this
          inline "Back to Lobby" link. */}
      <p className="mt-6 text-xs text-zinc-400">
        You can leave this screen. We&apos;ll notify you when an opponent joins.
      </p>
      <Link
        href="/lobby"
        className="mt-3 inline-flex items-center justify-center rounded-xl bg-white/[0.06] px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-zinc-200 transition hover:bg-white/10"
      >
        Back to Lobby
      </Link>
      <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
        No penalty if no one joins
      </p>
    </>
  );
}

export default function MatchRoomPanel({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerOrder, setPlayerOrder] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [displayScores, setDisplayScores] = useState<Record<string, number>>(
    {}
  );
  const [round, setRound] = useState(1);
  const [maxRounds, setMaxRounds] = useState(3);
  const [phase, setPhase] = useState<MatchPhase>("NORMAL");
  const [suddenDeathRound, setSuddenDeathRound] = useState(0);
  const [myPick, setMyPick] = useState<Lane | null>(null);
  const [result, setResult] = useState<MatchResultPayload | null>(null);
  const [pendingResult, setPendingResult] =
    useState<MatchResultPayload | null>(null);
  const [revealStage, setRevealStage] = useState<RevealStage>("IDLE");
  const [hasSubmittedPick, setHasSubmittedPick] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [opponentStatus, setOpponentStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [matchEnded, setMatchEnded] = useState(false);
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const tournamentRedirectScheduledRef = useRef(false);
  const tournamentContextRef = useRef({
    isTournament: false,
    tournamentId: null as string | null,
  });
  const [tournamentRedirectCountdown, setTournamentRedirectCountdown] = useState<
    number | null
  >(null);
  const [tournamentHandoff, setTournamentHandoff] =
    useState<TournamentMatchHandoff | null>(null);
  const [tournamentStagingCountdown, setTournamentStagingCountdown] = useState<
    number | null
  >(null);
  const [tournamentIntroVisible, setTournamentIntroVisible] = useState(false);
  const tournamentStagingDismissedRef = useRef(false);
  // Note: `matchType` can lag the actual handoff (the match:update payload may
  // arrive a few hundred ms after mount). Treating the handoff as proof of
  // tournament context lets the staging UI render immediately.
  const [playerCount, setPlayerCount] = useState(1);
  const [timer, setTimer] = useState<number | null>(null);

  // Phase 6C — readiness authority pre-start states.
  //
  // Three mutually-exclusive pre-start states:
  //
  //   • waitingForReturnDeadline !== null  → 2 players but opponent
  //     is absent; show "Waiting for opponent to return" overlay,
  //     gate canPick and the leave-controls.
  //   • isStaging === true                 → both players present;
  //     show the 3-2-1 staging overlay over a dimmed match canvas.
  //   • cancelledMessage !== null          → server emitted
  //     `match:cancelled`; show terminal banner then redirect.
  //
  // None of these unlock the lane buttons — `canPick` is gated on
  // all of them being clear (i.e. `match:status { timeoutSeconds }`
  // has authoritatively reported the pick window has begun).
  //
  // Hotfix: `isStaging` replaces the previous client-ticked
  // `stagingSecondsRemaining` state. The locally-computed seconds
  // were getting stuck at 0 if `match:status` arrived late or was
  // dropped — the boolean tracks only "server announced staging,
  // gameplay has not yet started" and is cleared the moment the
  // round timer's `match:status` payload lands.
  const [
    waitingForReturnDeadline,
    setWaitingForReturnDeadline,
  ] = useState<number | null>(null);
  const [absentOpponentName, setAbsentOpponentName] = useState<string | null>(
    null
  );
  const [returnSecondsRemaining, setReturnSecondsRemaining] = useState<
    number | null
  >(null);
  const [isStaging, setIsStaging] = useState<boolean>(false);
  const [stagingStartsAt, setStagingStartsAt] = useState<number | null>(null);
  const [stagingDurationMs, setStagingDurationMs] = useState<number>(3700);
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);
  const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(
    null
  );
  const disconnectCountdownRef = useRef<number | null>(null);
  const disconnectCountdownTickIntervalRef = useRef<number | null>(null);
  // Authoritative grace expiry (epoch ms) for the active opponent-
  // disconnect window. Tracked independently of the ticking visual so
  // that a deferred round-advance match:update (replayed after the
  // reveal hold) cannot tear down a countdown whose backend grace is
  // still running. Cleared by `clearDisconnectCountdownVisual`, so the
  // genuine grace-end events (reconnect / fresh timer / end / abort)
  // reset it naturally.
  const disconnectGraceExpiresAtRef = useRef<number | null>(null);

  const normalizedRoomCode = roomCode.trim().toUpperCase();

  // Read the tournament handoff once on mount (if present). This carries
  // round label + isFinal so the staging screen can show a richer intro.
  // The handoff is consumed and cleared so it cannot leak into a later match
  // in the same tab/session.
  useEffect(() => {
    const handoff = readTournamentMatchHandoff(normalizedRoomCode);
    if (handoff) {
      setTournamentHandoff(handoff);
      clearTournamentMatchHandoff(normalizedRoomCode);
    }
  }, [normalizedRoomCode]);

  const lastPickRoundRef = useRef<number | null>(null);
  /** Pick round when the local player locked a lane (authoritative result guard). */
  const resolvingPickRoundRef = useRef<number | null>(null);
  /** Round that advanced before match:result arrived (accept late packet for this round). */
  const lateResultRoundRef = useRef<number | null>(null);
  const matchResultRevealTimeoutRef = useRef<number | null>(null);
  /** True while the match:result reveal timer is armed. */
  const matchResultRevealArmedRef = useRef(false);
  /** Highest pick round we've finished resolving. */
  const lastFullyRevealedPickRoundRef = useRef(0);
  /** Closing pick round captured when arming reveal. */
  const closingRevealRoundSnapshotRef = useRef<number | null>(null);
  const revealStageRef = useRef<RevealStage>("IDLE");
  const previousScoresForPulseRef = useRef<Record<string, number>>({});
  /**
   * Latest canonical display name for the local player, as broadcast by the
   * server via `room:update` / `match:update`. Mirrored into a ref so the
   * `match:status` socket handler (whose closure does not list
   * `playerNames` as a dep) can compare against it without becoming stale.
   *
   * Used solely to suppress the server's "<username> locked pick." broadcast
   * from overwriting the local "You locked LANE. Waiting for opponent…"
   * status text. Opponent + system messages still flow through unchanged.
   */
  const myDisplayNameRef = useRef<string>("");
  /**
   * Reveal-hold setTimeout id. Armed by `applyRevealedResult`, it
   * is the single authority that transitions REVEALED → IDLE and
   * flushes any deferred `match:update` payload queued while the
   * reveal was running. Hotfix: replaces the previous timestamp-
   * based `revealHoldUntilRef` (whose comparisons created a race
   * window right at expiry) and the separate
   * `deferredMatchUpdateTimerRef` (which armed an independent
   * timer to flush the deferred payload). Consolidating into one
   * timeout removes any chance the flush fires before the hold
   * actually completes or vice-versa.
   */
  const revealHoldTimeoutRef = useRef<number | null>(null);
  /** Pending deferred onMatchUpdate payload. Flushed by `revealHoldTimeoutRef`. */
  const deferredMatchUpdatePayloadRef = useRef<MatchUpdatePayload | null>(null);

  useEffect(() => {
    revealStageRef.current = revealStage;
  }, [revealStage]);

  /**
   * Hotfix — single source of truth for "is the local reveal
   * pipeline currently in charge of the UI?" Used by
   * `match:update` and `match:status` to defer/freeze mutations
   * until the hold timer transitions us back to IDLE.
   *
   * Deliberately keyed off the active reveal-lifecycle TIMERS
   * (REVEALING tension delay or REVEALED hold), NOT the stage
   * state. Reason: `onMatchRejoinState` may seed
   * `revealStage = "REVEALING"` from a server snapshot without
   * arming any local timer. In that case nothing local would
   * ever flush a deferred `match:update`, so we must let
   * subsequent broadcasts pass straight through.
   */
  function isRevealActive(): boolean {
    return (
      matchResultRevealArmedRef.current ||
      revealHoldTimeoutRef.current !== null
    );
  }

  function clearMatchResultRevealTimeout() {
    if (matchResultRevealTimeoutRef.current !== null) {
      window.clearTimeout(matchResultRevealTimeoutRef.current);
      matchResultRevealTimeoutRef.current = null;
    }
  }

  function clearRevealHoldTimeout() {
    if (revealHoldTimeoutRef.current !== null) {
      window.clearTimeout(revealHoldTimeoutRef.current);
      revealHoldTimeoutRef.current = null;
    }
  }

  /**
   * Hotfix — clear EVERY reveal-lifecycle timer. Used in teardown
   * paths (match end, abort, unmount, rematch reset) so neither
   * the REVEALING delay nor the REVEALED hold can fire after the
   * surrounding flow has moved on.
   */
  function clearAllRevealTimers() {
    clearMatchResultRevealTimeout();
    clearRevealHoldTimeout();
    matchResultRevealArmedRef.current = false;
  }

  function clearDeferredMatchUpdate() {
    deferredMatchUpdatePayloadRef.current = null;
  }

  function clearDisconnectCountdownVisual() {
    if (disconnectCountdownTickIntervalRef.current !== null) {
      window.clearInterval(disconnectCountdownTickIntervalRef.current);
      disconnectCountdownTickIntervalRef.current = null;
    }
    disconnectCountdownRef.current = null;
    disconnectGraceExpiresAtRef.current = null;
    setDisconnectCountdown(null);
  }

  /**
   * True while the server's opponent-disconnect grace is still running
   * (we hold an authoritative future expiry). Used to protect the
   * visible abort countdown from being cleared by an unrelated
   * round-advance match:update during active grace.
   */
  function isDisconnectGraceStillActive() {
    return (
      disconnectGraceExpiresAtRef.current !== null &&
      Date.now() < disconnectGraceExpiresAtRef.current
    );
  }

  function startDisconnectCountdownVisual(seconds: number) {
    if (disconnectCountdownTickIntervalRef.current !== null) {
      window.clearInterval(disconnectCountdownTickIntervalRef.current);
      disconnectCountdownTickIntervalRef.current = null;
    }

    disconnectCountdownRef.current = seconds;
    setDisconnectCountdown(seconds);

    disconnectCountdownTickIntervalRef.current = window.setInterval(() => {
      setDisconnectCountdown((prev) => {
        if (prev === null || prev <= 0) return prev;

        const next = prev - 1;
        disconnectCountdownRef.current = next;

        if (next <= 0 && disconnectCountdownTickIntervalRef.current !== null) {
          window.clearInterval(disconnectCountdownTickIntervalRef.current);
          disconnectCountdownTickIntervalRef.current = null;
        }

        return next;
      });
    }, 1000);
  }

  /**
   * Restore the "Abort in..." countdown from the authoritative server
   * expiry after a refresh/rejoin. Unlike the live-message path (which
   * always restarts from 39s), this RESUMES from the remaining time so a
   * client that refreshes mid-grace sees the true countdown instead of a
   * reset clock. Returns early (and clears) when grace has already
   * elapsed.
   */
  function startDisconnectCountdownFromGrace(expiresAt: number) {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((expiresAt - Date.now()) / 1000)
    );

    if (remainingSeconds <= 0) {
      clearDisconnectCountdownVisual();
      return;
    }

    disconnectGraceExpiresAtRef.current = expiresAt;
    startDisconnectCountdownVisual(remainingSeconds);
  }

  const [finalScores, setFinalScores] = useState<Record<string, number> | null>(
    null
  );

  const [rematchVotes, setRematchVotes] = useState(0);
  const [rematchRequired, setRematchRequired] = useState(2);
  const [lastRematchRequesterId, setLastRematchRequesterId] = useState<
    string | null
  >(null);
  const [rematchDeclinedBy, setRematchDeclinedBy] = useState<string | null>(
    null
  );
  const [rematchRequested, setRematchRequested] = useState(false);
  const [scorePulse, setScorePulse] = useState<"p1" | "p2" | null>(null);
  const [impactResult, setImpactResult] = useState<
    "GOAL" | "SAVE" | "DRAW" | null
  >(null);
  const [screenEffect, setScreenEffect] = useState<
    "GOAL" | "SAVE" | "DRAW" | null
  >(null);
  const [resultFlavorMessage, setResultFlavorMessage] = useState<string | null>(
    null
  );
  // Phase 4 — Match Presentation Reconstruction (display-only state).
  // `roundTransition` is shown briefly when the round advances or the phase
  // shifts to sudden death. `resultBurstResult` flashes the full-screen
  // GOAL/SAVE/DRAW burst on reveal. Neither affects gameplay.
  const [roundTransition, setRoundTransition] = useState<{
    kind: RoundTransitionKind;
    label: string;
    sublabel?: string;
  } | null>(null);
  const [resultBurstResult, setResultBurstResult] = useState<ShotResult | null>(
    null
  );
  const prevRoundRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<MatchPhase>("NORMAL");
  // Used to drive the 3-2-1 ticker visible during the REVEALING tension window.
  const revealingStartedAtRef = useRef<number | null>(null);
  const [tensionTick, setTensionTick] = useState(0);
  const [matchStartedAt, setMatchStartedAt] = useState<number | null>(null);
  const [earlyCancelDeadlineAt, setEarlyCancelDeadlineAt] = useState<
    number | null
  >(null);
  const [matchInstance, setMatchInstance] = useState(1);
  const [matchType, setMatchType] = useState<MatchType>("unknown");
  const [leaveMatchBusy, setLeaveMatchBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [matchAborted, setMatchAborted] = useState(false);
  const [matchAbortedMessage, setMatchAbortedMessage] = useState<string | null>(
    null
  );
  const [redirectingAfterAbort, setRedirectingAfterAbort] = useState(false);

  const matchAbortedRef = useRef(false);
  const abortRedirectTimeoutRef = useRef<number | null>(null);

  function clearAbortRedirectTimeout() {
    if (abortRedirectTimeoutRef.current !== null) {
      window.clearTimeout(abortRedirectTimeoutRef.current);
      abortRedirectTimeoutRef.current = null;
    }
  }

  const clickSound = useMemo(() => new Audio("/sounds/click.mp3"), []);
  const goalSound = useMemo(() => new Audio("/sounds/goal.mp3"), []);
  const saveSound = useMemo(() => new Audio("/sounds/save.mp3"), []);

  useEffect(() => {
    let isMounted = true;

    async function loadIdentity() {
      const currentIdentity = await getCurrentPlayerIdentity();

      if (!isMounted) return;

      if (!currentIdentity) {
        router.replace("/auth/login");
        return;
      }

      clearActiveMatchIfPlayerMismatch(currentIdentity.playerId);
      setIdentity(currentIdentity);
    }

    loadIdentity();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!identity) return;

    const socket = getSocket();

    function joinRoom(currentIdentity: PlayerIdentity) {
      saveActiveMatch(normalizedRoomCode, currentIdentity.playerId);
      socket.emit("room:join", {
        roomCode: normalizedRoomCode,
        playerId: currentIdentity.playerId,
        username: currentIdentity.username || "",
      });
      // Phase 6C — explicit match-page presence signal. The server's
      // readiness authority uses ONLY this (and `player:leave`) to
      // decide whether the round timer is allowed to start. Emitting
      // immediately after `room:join` keeps the two signals tightly
      // coupled — the order doesn't matter on the server side because
      // both call `evaluateMatchStart`.
      socket.emit("player:present", {
        roomCode: normalizedRoomCode,
        playerId: currentIdentity.playerId,
      });
    }

    function onConnect() {
      setConnected(true);
      setStatus("Connected. Joining room...");
      if (identity) joinRoom(identity);
    }

    function onDisconnect() {
      setConnected(false);
      setStatus("Disconnected from server");
      setTimer(null);
    }

    function onRoomUpdate(payload: {
      roomCode: string;
      players: string[];
      playerNames?: Record<string, string>;
      playerCount: number;
      isReady: boolean;
      roles?: Record<string, Role>;
      kickerPlayerId?: string | null;
      keeperPlayerId?: string | null;
    }) {
      if (!isSocketEventForRoom(payload, normalizedRoomCode)) {
        return;
      }

      setPlayerCount(payload.playerCount);
      setPlayerOrder(payload.players);

      if (payload.roles && identity?.playerId) {
        setRoles(
          applyAuthoritativeRoles(
            {
              roles: payload.roles,
              kickerPlayerId: payload.kickerPlayerId,
              keeperPlayerId: payload.keeperPlayerId,
            },
            identity.playerId
          )
        );
      }

      if (payload.playerNames) {
        setPlayerNames(payload.playerNames);
      }

      if (payload.playerCount < 2 && !matchEnded) {
        setStatus("Waiting for opponent...");
        setTimer(null);
      }
    }

    function onMatchUpdate(data: MatchUpdatePayload) {
      if (!isSocketEventForRoom(data, normalizedRoomCode)) {
        console.warn(
          "[match:update] ignored foreign room",
          data.roomCode ?? data.code
        );
        return;
      }

      // === REVEAL GATE ===
      // Hotfix — the reveal pipeline owns all UI state mutations
      // while a result is on screen. Any `match:update` arriving
      // during REVEALING / REVEALED is queued; the latest payload
      // is replayed by `revealHoldTimeoutRef` when the hold ends.
      //
      // `match:end` is the one exception — a match-ending payload
      // is allowed through so we can tear down cleanly even if it
      // races the reveal hold.
      if (isRevealActive() && !data.matchEnded) {
        deferredMatchUpdatePayloadRef.current = data;
        console.info(
          "[RevealTiming] match:update queued — reveal active (stage=",
          revealStageRef.current,
          ", round=",
          data.round,
          ")"
        );
        return;
      }
      // === END REVEAL GATE ===

      const incomingRound = data.round;

      const previousRoundTracked = lastPickRoundRef.current;
      const pickRoundAdvanced =
        previousRoundTracked === null
          ? true
          : previousRoundTracked !== incomingRound;

      lastPickRoundRef.current = incomingRound;

      const inferredPhase: MatchPhase = data.phase || "NORMAL";

      const inferredSuddenRound =
        data.suddenDeathRound || data.suddenRound || 0;

      const myId = identity?.playerId;
      if (myId && data.scores && typeof data.scores === "object") {
        const prevSnap = previousScoresForPulseRef.current;
        const newScore1 = data.scores[myId] ?? 0;
        const oldScore1 = prevSnap[myId] ?? 0;
        const oppId = Object.keys(data.scores).find((id) => id !== myId);

        if (newScore1 !== oldScore1) {
          setScorePulse("p1");
          window.setTimeout(() => {
            setScorePulse(null);
          }, 300);
        }

        if (oppId) {
          const newScore2 = data.scores[oppId] ?? 0;
          const oldScore2 = prevSnap[oppId] ?? 0;

          if (newScore2 !== oldScore2) {
            setScorePulse("p2");
            window.setTimeout(() => {
              setScorePulse(null);
            }, 300);
          }
        }

        previousScoresForPulseRef.current = { ...data.scores };
      }

      if (identity?.playerId) {
        setRoles(applyAuthoritativeRoles(data, identity.playerId));
      } else {
        setRoles(data.roles);
      }

      if (data.matchType === "tournament" || data.tournamentId) {
        tournamentContextRef.current = {
          isTournament: true,
          tournamentId:
            data.tournamentId ?? tournamentContextRef.current.tournamentId,
        };
      }

      setScores(data.scores);
      setDisplayScores(data.scores);
      setRound(incomingRound);
      setMaxRounds(data.maxRounds);
      setPhase(inferredPhase);
      setSuddenDeathRound(inferredSuddenRound);

      if (typeof data.matchStartedAt === "number") {
        setMatchStartedAt(data.matchStartedAt);
      }

      if (typeof data.earlyCancelDeadlineAt === "number") {
        setEarlyCancelDeadlineAt(data.earlyCancelDeadlineAt);
      }

      if (typeof data.matchInstance === "number") {
        setMatchInstance(data.matchInstance);
      }

      if (data.matchType) {
        setMatchType(data.matchType);
      }

      if (data.tournamentId) {
        setTournamentId(data.tournamentId);
      }

      tournamentContextRef.current = {
        isTournament:
          data.matchType === "tournament" ||
          Boolean(data.tournamentId) ||
          tournamentContextRef.current.isTournament,
        tournamentId:
          data.tournamentId ?? tournamentContextRef.current.tournamentId,
      };

      if (pickRoundAdvanced) {
        const prev = previousRoundTracked;
        const hadPendingRevealTimer =
          matchResultRevealTimeoutRef.current !== null;

        clearMatchResultRevealTimeout();

        // Do NOT tear down an active opponent-disconnect grace countdown
        // just because the round advanced. In the
        // NEXT_ROUND_GRACE_FOR_ABSENT path the round-advance match:update
        // is deferred behind the reveal hold and replayed here AFTER the
        // grace match:status has already armed the countdown — clearing
        // unconditionally silently killed the visible "Aborting in Xs..."
        // block while the backend grace kept running to forfeit. Genuine
        // grace-end events (opponent reconnected / fresh round timer /
        // match end / abort) still clear it via their own paths.
        if (
          disconnectCountdownRef.current !== null &&
          !isDisconnectGraceStillActive()
        ) {
          clearDisconnectCountdownVisual();
        }

        if (prev !== null) {
          const resolutionComplete =
            lastFullyRevealedPickRoundRef.current >= prev;

          if (
            !hadPendingRevealTimer &&
            !matchResultRevealArmedRef.current &&
            !resolutionComplete
          ) {
            lateResultRoundRef.current = prev;
          } else {
            lateResultRoundRef.current = null;
          }

          matchResultRevealArmedRef.current = false;
        }

        resolvingPickRoundRef.current = null;
        setHasSubmittedPick(false);
        setMyPick(null);
        setResult(null);
        setPendingResult(null);
        setResultFlavorMessage(null);
        setOpponentStatus("");
        setRevealStage("IDLE");
      }

      if (data.playerNames) {
        setPlayerNames(data.playerNames);
      }

      if (data.matchEnded) {
        if (matchAbortedRef.current) {
          clearActiveMatch();
          return;
        }

        if (disconnectCountdownRef.current !== null) {
          clearDisconnectCountdownVisual();
        }
        clearAllRevealTimers();
        clearDeferredMatchUpdate();
        lateResultRoundRef.current = null;
        closingRevealRoundSnapshotRef.current = null;
        resolvingPickRoundRef.current = null;
        setMatchEnded(true);
        setStatus("Match finished");
        setTimer(null);
        setFinalScores(data.scores);
        clearActiveMatch();
        lastPickRoundRef.current = null;
        setHasSubmittedPick(false);
        setOpponentStatus("");
        return;
      }

      setMatchEnded(false);
      setFinalScores(null);
    }

    function onMatchStatus(data: MatchStatusPayload) {
      if (!isSocketEventForRoom(data, normalizedRoomCode)) {
        return;
      }

      // Hotfix — during REVEALING / REVEALED the reveal pipeline
      // owns the status text. Server-driven status messages still
      // arrive on their own clock (round-start announcements, lock
      // broadcasts, etc.) and used to clobber "Both players locked.
      // Revealing..." or "Result: GOAL" mid-reveal.
      //
      // Suppress every textual / phase / sudden-death mutation
      // while the reveal is active. Disconnect-countdown timers
      // and the authoritative `timeoutSeconds` branch (which IS
      // the next-round signal) are still respected: they don't
      // overwrite the reveal text, they just keep the underlying
      // socket / timer machinery in sync.
      const revealActive = isRevealActive();

      // Bug #2 fix: the realtime server broadcasts
      //   "<username> locked pick."
      // to the WHOLE room on every pick. Suppress ONLY the local
      // player's self-referential broadcast — opponent / system
      // messages still flow through unchanged when outside reveal.
      const selfName = myDisplayNameRef.current;
      const isSelfLockBroadcast =
        typeof data.message === "string" &&
        selfName.length > 0 &&
        data.message === `${selfName} locked pick.`;

      if (!isSelfLockBroadcast && !revealActive) {
        setStatus(data.message);
      }

      const messageLower = data.message.toLowerCase();
      if (disconnectCountdownRef.current !== null) {
        if (messageLower.includes("opponent reconnected")) {
          clearDisconnectCountdownVisual();
        }
      }

      if (isReconnectForfeitCountdownStatusMessage(data.message)) {
        // Resume from the authoritative server expiry when present so the
        // grace ref reflects the true remaining time; fall back to a full
        // 39s window if the payload omitted it. `startDisconnectCountdownFromGrace`
        // sets `disconnectGraceExpiresAtRef`, which protects the countdown
        // from a deferred round-advance match:update during active grace.
        const graceExpiresAt =
          typeof data.expiresAt === "number" && data.expiresAt > Date.now()
            ? data.expiresAt
            : Date.now() + 39_000;
        startDisconnectCountdownFromGrace(graceExpiresAt);

        // The abort countdown is the authoritative UI signal. Override
        // any locked-pick "Waiting for opponent" / "Opponent is
        // thinking..." copy so a player who stayed on the page (no
        // refresh) isn't misled into thinking the match is proceeding
        // normally. The red "Aborting match in Xs..." block carries the
        // countdown itself; here we just clear the conflicting text.
        // Guarded by `!revealActive` so we never clobber reveal copy
        // (the server never arms this grace mid-reveal anyway).
        if (!revealActive) {
          setStatus("Opponent disconnected.");
          setOpponentStatus("");
        }
      }

      if (!revealActive) {
        if (data.phase) {
          setPhase(data.phase);
        }

        if (typeof data.suddenDeathRound === "number") {
          setSuddenDeathRound(data.suddenDeathRound);
        }

        if (typeof data.suddenRound === "number") {
          setSuddenDeathRound(data.suddenRound);
        }
      }

      if (typeof data.timeoutSeconds === "number") {
        // Hotfix — authoritative gameplay-has-begun signal.
        //
        // `match:status` with `timeoutSeconds` is emitted by the
        // server's `startRoundTimer` (and only by it). Every
        // pre-start overlay state must be torn down here so the
        // overlay never lingers past the moment the pick window
        // actually opens, regardless of whether `match:stagingBegin`
        // or `match:update(matchStartedAt)` arrived in the expected
        // order — or at all.
        setIsStaging(false);
        setStagingStartsAt(null);
        setWaitingForReturnDeadline(null);
        setAbsentOpponentName(null);
        setReturnSecondsRemaining(null);

        if (disconnectCountdownRef.current !== null) {
          clearDisconnectCountdownVisual();
        }

        // Hotfix — use the timer-based `isRevealActive()` gate
        // instead of inspecting `revealStageRef`. The reveal
        // pipeline's hold timer is what ultimately clears the
        // stage; if no local reveal timer is in flight (e.g.
        // `onMatchRejoinState` seeded a placeholder REVEALING
        // from a server snapshot without arming one), we are
        // free to apply the round-reset clears here. Pre-start
        // staging / waiting clears above come from PR #14.
        if (!isRevealActive()) {
          clearAllRevealTimers();
          setRevealStage("IDLE");
          setHasSubmittedPick(false);
          setOpponentStatus("");
        }

        setTimer(data.timeoutSeconds);
      }
    }

    function applyRevealedResult(authoritative: MatchResultPayload) {
      const snap = closingRevealRoundSnapshotRef.current;
      closingRevealRoundSnapshotRef.current = null;

      if (snap !== null) {
        lastFullyRevealedPickRoundRef.current = Math.max(
          lastFullyRevealedPickRoundRef.current,
          snap
        );
      }

      if (typeof authoritative.round === "number") {
        lastFullyRevealedPickRoundRef.current = Math.max(
          lastFullyRevealedPickRoundRef.current,
          authoritative.round
        );
        lateResultRoundRef.current = null;
      }

      setResult(authoritative);
      setPendingResult(authoritative);
      setRevealStage("REVEALED");
      setStatus(
        authoritative.statusMessage || `Result: ${authoritative.result}`
      );
      setResultFlavorMessage(pickResultFlavorMessage(authoritative.result));
      setOpponentStatus("");

      // "Dramatic hold": keep the result on screen so REVEALED actually
      // paints before the server's next-round `match:update` clears it.
      // Casual gets a shorter hold (~1500ms); tournament keeps the longer
      // cinematic hold (~4000ms).
      //
      // Hotfix — the hold is now a single setTimeout that owns BOTH
      // the REVEALED → IDLE transition AND flushing any `match:update`
      // queued by the reveal gate. One timer = one source of truth,
      // so the flush can't race the stage transition.
      const holdMs = tournamentContextRef.current.isTournament
        ? TOURNAMENT_REVEAL_HOLD_MS
        : CASUAL_REVEAL_HOLD_MS;

      clearRevealHoldTimeout();
      revealHoldTimeoutRef.current = window.setTimeout(() => {
        revealHoldTimeoutRef.current = null;
        setRevealStage("IDLE");

        const pending = deferredMatchUpdatePayloadRef.current;
        deferredMatchUpdatePayloadRef.current = null;
        if (pending) {
          console.info(
            "[RevealTiming] flushing deferred match:update — round=",
            pending.round
          );
          onMatchUpdate(pending);
        }
      }, holdMs);

      console.info(
        "[RevealTiming] reveal hold armed for",
        holdMs,
        "ms — round=",
        authoritative.round,
        "tournament=",
        tournamentContextRef.current.isTournament
      );

      if (authoritative.result === "GOAL") {
        goalSound.currentTime = 0;
        void goalSound.play().catch(() => {});
      } else if (authoritative.result === "SAVE") {
        saveSound.currentTime = 0;
        void saveSound.play().catch(() => {});
      }

      if (authoritative.result === "GOAL") {
        setImpactResult("GOAL");
        window.setTimeout(() => {
          setImpactResult(null);
        }, 600);
      } else if (authoritative.result === "SAVE") {
        setImpactResult("SAVE");
        window.setTimeout(() => {
          setImpactResult(null);
        }, 600);
      } else if (authoritative.result === "DRAW") {
        setImpactResult("DRAW");
        window.setTimeout(() => {
          setImpactResult(null);
        }, 500);
      }

      if (authoritative.result === "GOAL") {
        setScreenEffect("GOAL");
        window.setTimeout(() => {
          setScreenEffect(null);
        }, 600);
      } else if (authoritative.result === "SAVE") {
        setScreenEffect("SAVE");
        window.setTimeout(() => {
          setScreenEffect(null);
        }, 600);
      } else if (authoritative.result === "DRAW") {
        setScreenEffect("DRAW");
        window.setTimeout(() => {
          setScreenEffect(null);
        }, 500);
      }
    }

    function onMatchResult(data: MatchResultPayload) {
      if (!isSocketEventForRoom(data, normalizedRoomCode)) {
        console.warn(
          "[match:result] ignored foreign room",
          data.roomCode ?? data.code
        );
        return;
      }

      const authoritative = normalizeAuthoritativeResult(data);
      if (!authoritative) {
        console.warn("[match:result] ignored invalid payload", data);
        return;
      }

      assertAuthoritativeResultIntegrity(authoritative);

      const expectedRound =
        resolvingPickRoundRef.current ?? lastPickRoundRef.current;

      if (
        !isResultRoundAcceptable(
          authoritative.round,
          expectedRound,
          lateResultRoundRef.current
        )
      ) {
        console.warn(
          "[match:result] ignored stale round",
          authoritative.round,
          "expected",
          expectedRound,
          "late",
          lateResultRoundRef.current
        );
        return;
      }

      // Hotfix — `match:result` is now the single authority that
      // enters REVEALING. Tear down any in-flight reveal timers
      // first so a racing earlier result can't keep ticking.
      clearAllRevealTimers();
      closingRevealRoundSnapshotRef.current =
        authoritative.round ?? expectedRound ?? lastPickRoundRef.current;

      // Hotfix — the "Opponent locked their choice" interstitial
      // is no longer relevant once the result is in flight. Clear
      // it immediately so the reveal narrative is the only thing
      // on screen.
      setOpponentStatus("");
      setTimer(null);

      const bothLocked = Boolean(
        authoritative.kickerPick && authoritative.keeperPick
      );
      // Hotfix Sprint (production-match-reconnect-and-reveal-polish):
      // casual matches previously revealed instantly when both picks were
      // already on the wire (revealDelayMs = 0). That made the GOAL/SAVE/
      // DRAW pop in too fast and disoriented live testers. We now always
      // linger in REVEALING for the configured casual tension window so
      // both clients see a stable "Both players locked → Revealing..."
      // transition before the result paints. Tournament pacing is
      // unchanged — it already used the longer cinematic.
      const revealDelayMs = tournamentContextRef.current.isTournament
        ? TOURNAMENT_MATCH_RESULT_REVEAL_MS
        : MATCH_RESULT_REVEAL_MS;

      if (revealDelayMs <= 0) {
        matchResultRevealArmedRef.current = false;
        applyRevealedResult(authoritative);
        return;
      }

      setPendingResult(authoritative);
      setRevealStage("REVEALING");
      revealingStartedAtRef.current = Date.now();
      const lockedLabel = bothLocked
        ? "Both players locked. Revealing..."
        : "Locked. Revealing result...";
      setStatus(lockedLabel);
      matchResultRevealArmedRef.current = true;

      matchResultRevealTimeoutRef.current = window.setTimeout(() => {
        matchResultRevealTimeoutRef.current = null;
        matchResultRevealArmedRef.current = false;
        applyRevealedResult(authoritative);
      }, revealDelayMs);
    }

    function onMatchEnd(payload: MatchEndPayload) {
      if (disconnectCountdownRef.current !== null) {
        clearDisconnectCountdownVisual();
      }
      clearAllRevealTimers();
      clearDeferredMatchUpdate();
      lateResultRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      resolvingPickRoundRef.current = null;
      lastFullyRevealedPickRoundRef.current = 0;
      lastPickRoundRef.current = null;
      previousScoresForPulseRef.current = {};
      setScorePulse(null);
      setImpactResult(null);
      setScreenEffect(null);
      setResultFlavorMessage(null);
      setOpponentStatus("");
      setHasSubmittedPick(false);
      setMatchEnded(true);
      setFinalScores(payload.scores);
      setDisplayScores(payload.scores);
      setStatus("Match complete");
      setTimer(null);
      clearActiveMatch();
      setRematchVotes(0);
      setRematchRequired(2);
      setLastRematchRequesterId(null);
      setRematchDeclinedBy(null);
      setRematchRequested(false);
      setLeaveMatchBusy(false);

      if (payload.tournamentId) {
        setTournamentId(payload.tournamentId);
        tournamentContextRef.current = {
          isTournament: true,
          tournamentId: payload.tournamentId,
        };
      }
    }

    function onRematchUpdate(payload: RematchUpdatePayload) {
      setRematchVotes(payload.votes);
      setRematchRequired(payload.required);
      setLastRematchRequesterId(
        payload.lastRequesterId === undefined
          ? null
          : payload.lastRequesterId
      );
      if (payload.votes === 0) {
        setRematchRequested(false);
      }
      if (payload.votes > 0) {
        setRematchDeclinedBy(null);
      }
    }

    function onRematchDeclined(payload: RematchDeclinedPayload) {
      setRematchDeclinedBy(payload.declinedBy);
    }

    function onRematchAccepted() {
      if (disconnectCountdownRef.current !== null) {
        clearDisconnectCountdownVisual();
      }
      clearAllRevealTimers();
      clearDeferredMatchUpdate();
      lateResultRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      resolvingPickRoundRef.current = null;
      lastFullyRevealedPickRoundRef.current = 0;
      lastPickRoundRef.current = null;
      previousScoresForPulseRef.current = {};
      setScorePulse(null);
      setImpactResult(null);
      setScreenEffect(null);
      setResultFlavorMessage(null);
      setOpponentStatus("");
      setMatchEnded(false);
      setFinalScores(null);
      setResult(null);
      setPendingResult(null);
      setMyPick(null);
      setHasSubmittedPick(false);
      setRematchVotes(0);
      setRematchRequired(2);
      setLastRematchRequesterId(null);
      setRematchDeclinedBy(null);
      setRematchRequested(false);
      setRevealStage("IDLE");
      setPhase("NORMAL");
      setSuddenDeathRound(0);
      setMatchStartedAt(null);
      setEarlyCancelDeadlineAt(null);
      matchAbortedRef.current = false;
      setMatchAborted(false);
      setMatchAbortedMessage(null);
      setRedirectingAfterAbort(false);
      clearAbortRedirectTimeout();
      setLeaveMatchBusy(false);
      setStatus("Rematch started");
    }

    function onMatchRejoinState(data: MatchRejoinStatePayload) {
      if (!isSocketEventForRoom(data, normalizedRoomCode)) {
        return;
      }

      // Server-authoritative snapshot delivered right after rejoin. Reaches
      // us AFTER the broadcast match:update, so the normal "round advanced"
      // reset has already wiped local state. We now overlay the real per-
      // player truth on top:
      //   - my own pick (so the UI shows "Pick locked" + selected lane)
      //   - whether the opponent has locked (boolean only — no leakage)
      //   - whether the server is mid-resolution
      // This is what unblocks the "I refreshed and now can't click"
      // scenario: without this, hasSubmittedPick stays false and the next
      // click is silently dropped server-side by the "already picked"
      // guard in match:pick.
      const myRole = data.myRole ?? null;
      const myPickFromServer = data.myPick ?? null;
      const opponentLocked = Boolean(data.opponentHasLocked);
      const serverResolving = Boolean(data.isResolving);

      if (process.env.NODE_ENV !== "production") {
        console.info("[match:rejoinState] applying", {
          roomCode: data.roomCode ?? normalizedRoomCode,
          playerId: identity?.playerId,
          socketId: socket.id,
          myRole,
          myPick: myPickFromServer,
          opponentLocked,
          round: data.round,
          phase: data.phase,
          isResolving: serverResolving,
          matchEnded: data.matchEnded,
        });
      }

      if (data.matchEnded) {
        return;
      }

      // Restore the opponent-disconnect "Abort in..." countdown after a
      // refresh during an active grace window. The server sends the
      // authoritative expiry so we resume from the remaining time rather
      // than restarting the clock. When grace targets the OTHER player
      // and is still live, seed the visual; otherwise leave it cleared.
      const graceRestored =
        Boolean(data.disconnectGrace?.active) &&
        typeof data.disconnectGrace?.expiresAt === "number" &&
        data.disconnectGrace.expiresAt > Date.now();

      if (graceRestored) {
        startDisconnectCountdownFromGrace(data.disconnectGrace!.expiresAt!);
      }

      if (typeof data.round === "number") {
        lastPickRoundRef.current = data.round;
      }

      if (myPickFromServer) {
        setMyPick(myPickFromServer);
        setHasSubmittedPick(true);
        resolvingPickRoundRef.current =
          data.round ?? lastPickRoundRef.current ?? null;

        if (serverResolving || opponentLocked) {
          setStatus("Both players locked. Revealing...");
          setOpponentStatus("Opponent locked their choice");
          setRevealStage("REVEALING");
          revealingStartedAtRef.current = Date.now();
        } else if (graceRestored) {
          // Our pick is locked, but the opponent disconnected and the
          // backend forfeit/abort grace is still running. The red abort
          // countdown block carries the authoritative message — do NOT
          // claim the opponent is "thinking" / that we're merely
          // "waiting", which would bury the abort countdown and mislead
          // the player into thinking the match is proceeding normally.
          setStatus(`You locked ${myPickFromServer}. Opponent disconnected.`);
          setOpponentStatus("");
          setRevealStage("LOCKED");
        } else {
          setStatus(
            `You locked ${myPickFromServer}. Waiting for opponent...`
          );
          setOpponentStatus("Opponent is thinking...");
          setRevealStage("LOCKED");
        }
      } else {
        setMyPick(null);
        setHasSubmittedPick(false);
        resolvingPickRoundRef.current = null;
        if (opponentLocked) {
          setStatus("Opponent locked. Make your pick.");
          setOpponentStatus("Opponent locked their choice");
        } else {
          setOpponentStatus("");
        }
        setRevealStage("IDLE");
      }
    }

    function onErrorMessage(payload: { message: string }) {
      setLeaveMatchBusy(false);
      setStatus(payload.message);
    }

    function onMatchAborted(_payload: MatchAbortedPayload) {
      matchAbortedRef.current = true;
      setLeaveMatchBusy(false);
      setMatchAborted(true);
      setMatchAbortedMessage("No penalty applied. Stakes refunded.");
      setRedirectingAfterAbort(false);

      if (disconnectCountdownRef.current !== null) {
        clearDisconnectCountdownVisual();
      }

      clearAllRevealTimers();
      clearDeferredMatchUpdate();
      clearActiveMatch();
      setStatus("Match cancelled. No penalty applied.");

      clearAbortRedirectTimeout();
      abortRedirectTimeoutRef.current = window.setTimeout(() => {
        abortRedirectTimeoutRef.current = null;
        setRedirectingAfterAbort(true);
        router.push("/lobby");
      }, 2000);
    }

    // Phase 6C — readiness authority emits.
    function onMatchWaitingForOpponent(payload: {
      roomCode?: string;
      expiresAt?: number;
      absentPlayerName?: string | null;
    }) {
      if (!isSocketEventForRoom(payload, normalizedRoomCode)) return;
      if (typeof payload.expiresAt !== "number") return;
      // Returning to the waiting-for-opponent state means staging
      // had to be aborted server-side; mirror that here.
      setIsStaging(false);
      setStagingStartsAt(null);
      setWaitingForReturnDeadline(payload.expiresAt);
      setAbsentOpponentName(payload.absentPlayerName ?? null);
      setStatus(
        payload.absentPlayerName
          ? `Waiting for ${payload.absentPlayerName} to return...`
          : "Waiting for opponent to return..."
      );
    }

    function onMatchStagingBegin(payload: {
      roomCode?: string;
      startsAt?: number;
      durationMs?: number;
    }) {
      if (!isSocketEventForRoom(payload, normalizedRoomCode)) return;
      if (typeof payload.startsAt !== "number") return;
      setWaitingForReturnDeadline(null);
      setAbsentOpponentName(null);
      setReturnSecondsRemaining(null);
      const duration =
        typeof payload.durationMs === "number" && payload.durationMs > 0
          ? payload.durationMs
          : 3700;
      setStagingDurationMs(duration);
      setStagingStartsAt(payload.startsAt);
      setIsStaging(true);
      // Hotfix — if a mid-match reconnect is in progress when the
      // server walks us back through staging (e.g. opponent return
      // window resolved into a fresh staging arm), the 39s
      // disconnect visual is no longer relevant.
      if (disconnectCountdownRef.current !== null) {
        clearDisconnectCountdownVisual();
      }
      setStatus("Match starting...");
    }

    function onMatchCancelled(payload: {
      roomCode?: string;
      reason?: string;
      message?: string;
    }) {
      if (!isSocketEventForRoom(payload, normalizedRoomCode)) return;
      const message =
        typeof payload.message === "string" && payload.message
          ? payload.message
          : "Match cancelled — no penalty applied.";
      setCancelledMessage(message);
      setWaitingForReturnDeadline(null);
      setAbsentOpponentName(null);
      setReturnSecondsRemaining(null);
      setIsStaging(false);
      setStagingStartsAt(null);
      setStatus(message);
      clearActiveMatch();

      clearAbortRedirectTimeout();
      abortRedirectTimeoutRef.current = window.setTimeout(() => {
        abortRedirectTimeoutRef.current = null;
        router.push("/lobby");
      }, 2500);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:update", onRoomUpdate);
    socket.on("match:update", onMatchUpdate);
    socket.on("match:rejoinState", onMatchRejoinState);
    socket.on("match:status", onMatchStatus);
    socket.on("match:result", onMatchResult);
    socket.on("match:end", onMatchEnd);
    socket.on("match:rematch:update", onRematchUpdate);
    socket.on("match:rematch:accepted", onRematchAccepted);
    socket.on("match:rematch:declined", onRematchDeclined);
    socket.on("match:aborted", onMatchAborted);
    socket.on("error:message", onErrorMessage);
    // Phase 6C — readiness authority pre-start events.
    socket.on("match:waitingForOpponent", onMatchWaitingForOpponent);
    socket.on("match:stagingBegin", onMatchStagingBegin);
    socket.on("match:cancelled", onMatchCancelled);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      // Phase 6C — drop match-page presence FIRST so the server
      // re-evaluates readiness immediately. If pre-match, this can
      // arm the return window; if post-match, the server ignores it.
      if (identity) {
        socket.emit("player:leave", {
          roomCode: normalizedRoomCode,
          playerId: identity.playerId,
        });
      }
      socket.emit("room:leave", { roomCode: normalizedRoomCode });
      clearAbortRedirectTimeout();
      clearDisconnectCountdownVisual();
      clearAllRevealTimers();
      clearDeferredMatchUpdate();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:update", onRoomUpdate);
      socket.off("match:update", onMatchUpdate);
      socket.off("match:rejoinState", onMatchRejoinState);
      socket.off("match:status", onMatchStatus);
      socket.off("match:result", onMatchResult);
      socket.off("match:end", onMatchEnd);
      socket.off("match:rematch:update", onRematchUpdate);
      socket.off("match:rematch:accepted", onRematchAccepted);
      socket.off("match:rematch:declined", onRematchDeclined);
      socket.off("match:aborted", onMatchAborted);
      socket.off("error:message", onErrorMessage);
      socket.off("match:waitingForOpponent", onMatchWaitingForOpponent);
      socket.off("match:stagingBegin", onMatchStagingBegin);
      socket.off("match:cancelled", onMatchCancelled);
    };
  }, [normalizedRoomCode, identity, router]);

  useEffect(() => {
    if (!matchEnded || matchType !== "tournament" || !tournamentId) {
      return;
    }

    if (tournamentRedirectScheduledRef.current) {
      return;
    }

    tournamentRedirectScheduledRef.current = true;

    let secondsLeft = Math.ceil(TOURNAMENT_POST_MATCH_REDIRECT_MS / 1000);
    setTournamentRedirectCountdown(secondsLeft);

    const countdownInterval = window.setInterval(() => {
      secondsLeft -= 1;
      setTournamentRedirectCountdown(secondsLeft > 0 ? secondsLeft : 0);
    }, 1000);

    const redirectTimeout = window.setTimeout(() => {
      window.clearInterval(countdownInterval);
      clearActiveMatch();
      router.push(`/tournaments/${tournamentId}`);
    }, TOURNAMENT_POST_MATCH_REDIRECT_MS);

    return () => {
      window.clearInterval(countdownInterval);
      window.clearTimeout(redirectTimeout);
    };
  }, [matchEnded, matchType, tournamentId, router]);

  const isTournamentMatch =
    matchType === "tournament" || tournamentHandoff !== null;

  const isFinalTournamentMatch =
    isTournamentMatch && (tournamentHandoff?.isFinal ?? false);

  const tournamentRoundDisplayLabel =
    tournamentHandoff?.roundLabel ?? (isTournamentMatch ? "Tournament" : null);

  // Pre-match tournament staging: 3 / 2 / 1 countdown overlay shown only on a
  // fresh tournament match (no picks yet, no result, no match-ended state).
  // Display-only — does NOT block socket events or input. If the user picks a
  // lane or the round advances, the overlay is hidden immediately.
  useEffect(() => {
    if (!isTournamentMatch || matchEnded || matchAborted) {
      setTournamentStagingCountdown(null);
      return;
    }

    if (tournamentStagingDismissedRef.current) return;

    // Only show on a fresh match (round 1, no pick yet, no reveal, no goals).
    const everyScoreZero = Object.values(scores).every((v) => !v || v === 0);
    const isFreshMatch =
      round <= 1 &&
      !hasSubmittedPick &&
      revealStage === "IDLE" &&
      everyScoreZero;

    if (!isFreshMatch) {
      setTournamentStagingCountdown(null);
      return;
    }

    let secondsLeft = MATCH_STAGING_SECONDS_TOURNAMENT;
    setTournamentStagingCountdown(secondsLeft);
    const intervalId = window.setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        window.clearInterval(intervalId);
        setTournamentStagingCountdown(0);
        tournamentStagingDismissedRef.current = true;
        // After countdown, briefly show the intro pill.
        setTournamentIntroVisible(true);
        window.setTimeout(() => setTournamentIntroVisible(false), 3000);
        // Hide the overlay shortly after reaching 0.
        window.setTimeout(() => setTournamentStagingCountdown(null), 250);
        return;
      }
      setTournamentStagingCountdown(secondsLeft);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    isTournamentMatch,
    matchEnded,
    matchAborted,
    matchInstance,
    round,
    hasSubmittedPick,
    revealStage,
    scores,
  ]);

  // If the user picks before the staging finishes, dismiss it instantly so it
  // never blocks the lane buttons visually.
  useEffect(() => {
    if (hasSubmittedPick && tournamentStagingCountdown !== null) {
      tournamentStagingDismissedRef.current = true;
      setTournamentStagingCountdown(null);
    }
  }, [hasSubmittedPick, tournamentStagingCountdown]);

  useEffect(() => {
    if (
      matchEnded ||
      playerCount < 2 ||
      matchStartedAt === null ||
      earlyCancelDeadlineAt === null
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    matchEnded,
    playerCount,
    matchStartedAt,
    earlyCancelDeadlineAt,
  ]);

  // Phase 6C — return-window ticker. Counts down from
  // `waitingForReturnDeadline` at 1Hz so the overlay can render the
  // remaining seconds. Cleared whenever the deadline is null.
  useEffect(() => {
    if (waitingForReturnDeadline === null) {
      setReturnSecondsRemaining(null);
      return;
    }

    const tick = () => {
      const remainingMs = waitingForReturnDeadline - Date.now();
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setReturnSecondsRemaining(seconds);
    };

    tick();
    const interval = window.setInterval(tick, 1000);

    return () => window.clearInterval(interval);
  }, [waitingForReturnDeadline]);

  // Hotfix — the previous client-ticked staging-seconds-remaining
  // state was removed. The 3-2-1 cinematic still plays for ~3.7s
  // (the staging overlay UI doesn't render a numeric countdown
  // anymore) and is torn down authoritatively by `match:status`
  // with `timeoutSeconds` — see `onMatchStatus`.

  // Belt-and-braces — when `matchStartedAt` flips non-null (via
  // `match:update`), clear every pre-start state. This is
  // redundant with the clears inside `onMatchStatus` but covers
  // the rare ordering where `match:update` arrives before
  // `match:status`.
  useEffect(() => {
    if (matchStartedAt !== null) {
      setIsStaging(false);
      setStagingStartsAt(null);
      setWaitingForReturnDeadline(null);
      setAbsentOpponentName(null);
      setReturnSecondsRemaining(null);
    }
  }, [matchStartedAt]);

  // Phase 4: pre-reveal tension ticker.
  // Ticks every 120ms while in REVEALING so the 3-2-1 countdown can render
  // off `revealingStartedAtRef`. Cleared automatically when the stage exits.
  useEffect(() => {
    if (revealStage !== "REVEALING") {
      revealingStartedAtRef.current = null;
      setTensionTick(0);
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      if (cancelled) return;
      setTensionTick((prev) => prev + 1);
    }, 120);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [revealStage]);

  // Phase 4: round transition overlay. Fires on round/phase change, never on
  // initial mount. Self-clears after ROUND_TRANSITION_VISIBLE_MS so the
  // overlay never lingers across rounds.
  useEffect(() => {
    if (matchEnded || matchAborted) {
      setRoundTransition(null);
      prevRoundRef.current = round;
      prevPhaseRef.current = phase;
      return;
    }

    if (isTournamentMatch && tournamentStagingCountdown !== null) {
      // Don't stack a round transition on top of the staging screen — the
      // staging screen already handles the "Round 1" intro for tournaments.
      prevRoundRef.current = round;
      prevPhaseRef.current = phase;
      return;
    }

    const transition = classifyRoundTransition({
      newRound: round,
      prevRound: prevRoundRef.current,
      maxRounds,
      phase,
      prevPhase: prevPhaseRef.current,
    });

    prevRoundRef.current = round;
    prevPhaseRef.current = phase;

    if (!transition) return;

    setRoundTransition(transition);
    const timeout = window.setTimeout(() => {
      setRoundTransition(null);
    }, ROUND_TRANSITION_VISIBLE_MS);

    return () => window.clearTimeout(timeout);
  }, [
    round,
    phase,
    maxRounds,
    matchEnded,
    matchAborted,
    isTournamentMatch,
    tournamentStagingCountdown,
  ]);

  // Phase 4: full-screen GOAL/SAVE/DRAW burst on reveal.
  //
  // Bug #5 fix: the cleanup ALSO resets `resultBurstResult` to null. If
  // the revealStage transitions out of REVEALED before the auto-clear
  // timeout fires (e.g. next-round match:update arrives early), the
  // pending `setResultBurstResult(null)` timer is cancelled by the
  // cleanup. Without this explicit reset the state would stick on
  // "GOAL"/"SAVE"/"DRAW" indefinitely; only the CSS opacity:0 keyframe
  // hides it visually. Resetting here keeps state honest and prevents a
  // stale burst from popping back if the overlay is ever toggled by
  // visibility alone.
  useEffect(() => {
    if (revealStage !== "REVEALED" || !result?.result) {
      return;
    }

    setResultBurstResult(result.result);
    const timeout = window.setTimeout(() => {
      setResultBurstResult(null);
    }, RESULT_OVERLAY_VISIBLE_MS);

    return () => {
      window.clearTimeout(timeout);
      setResultBurstResult(null);
    };
  }, [revealStage, result?.result, result?.round]);

  useEffect(() => {
    if (timer === null || timer <= 0) return;

    const interval = setInterval(() => {
      setTimer((previous) => {
        if (previous === null) return null;

        if (previous <= 1) {
          clearInterval(interval);
          return 0;
        }

        return previous - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  const myPlayerId = identity?.playerId || "";
  const myRole = myPlayerId ? roles[myPlayerId] : undefined;

  // Keep myDisplayNameRef in sync with the canonical server name. Prefer
  // the server-broadcast playerNames entry (matches the exact string the
  // realtime server uses when emitting "<name> locked pick.") and fall
  // back to the local identity username, finally to the server's "Player"
  // default. This is read by the `match:status` self-lock filter below.
  useEffect(() => {
    if (myPlayerId && playerNames[myPlayerId]) {
      myDisplayNameRef.current = playerNames[myPlayerId];
      return;
    }
    const fallback = (identity?.username ?? "").trim();
    myDisplayNameRef.current = fallback || "Player";
  }, [myPlayerId, playerNames, identity]);

  useEffect(() => {
    if (!myPlayerId || playerCount < 2) return;

    const roleValues = Object.values(roles);
    const myRoleValue = roles[myPlayerId];
    const kickerIds = Object.keys(roles).filter(
      (id) => roles[id] === "KICKER"
    );
    const keeperIds = Object.keys(roles).filter(
      (id) => roles[id] === "KEEPER"
    );

    if (kickerIds.length !== 1 || keeperIds.length !== 1) {
      console.warn("[match:roles] client sees invalid role map", {
        roomCode: normalizedRoomCode,
        myPlayerId,
        myRole: myRoleValue,
        roles,
        kickerIds,
        keeperIds,
      });
    } else if (myRoleValue && kickerIds[0] === keeperIds[0]) {
      console.warn("[match:roles] both players mapped to same role", roles);
    }
  }, [roles, myPlayerId, playerCount, normalizedRoomCode]);

  const opponentId = useMemo(() => {
    return playerOrder.find((id) => id !== myPlayerId);
  }, [playerOrder, myPlayerId]);

  const myName = myPlayerId ? playerNames[myPlayerId] || "You" : "You";
  const opponentName = opponentId
    ? playerNames[opponentId] || "Opponent"
    : "Opponent";

  const activeScores = finalScores || displayScores || scores;
  const myScore = myPlayerId ? activeScores[myPlayerId] ?? 0 : 0;
  const opponentScore = opponentId ? activeScores[opponentId] ?? 0 : 0;


  const showOpponentRematchPrompt = useMemo(() => {
    if (isTournamentMatch) return false;

    return (
      matchEnded &&
      !!identity &&
      rematchVotes >= 1 &&
      rematchVotes < rematchRequired &&
      !!lastRematchRequesterId &&
      lastRematchRequesterId !== myPlayerId &&
      !rematchRequested
    );
  }, [
    isTournamentMatch,
    matchEnded,
    identity,
    rematchVotes,
    rematchRequired,
    lastRematchRequesterId,
    myPlayerId,
    rematchRequested,
  ]);

  const normalTurns = maxRounds * 2;
  const isLateGame = round >= maxRounds * 2 - 2;
  const isSuddenDeath = phase === "SUDDEN_DEATH";

  const roundLabel =
    phase === "SUDDEN_DEATH"
      ? `Sudden Death ${
          suddenDeathRound ||
          Math.max(1, Math.ceil((round - normalTurns) / 2))
        }`
      : `${round} / ${normalTurns}`;

  const phaseLabel = isSuddenDeath ? "SUDDEN DEATH" : "NORMAL MATCH";

  const shownResult = result || pendingResult;

  const kickerResultLabel = useMemo(() => {
    if (!shownResult) return "Kicker";
    const playerId = shownResult.kickerPlayerId;
    if (playerId && playerNames[playerId]) {
      return playerNames[playerId];
    }
    return "Kicker";
  }, [shownResult, playerNames]);

  const keeperResultLabel = useMemo(() => {
    if (!shownResult) return "Keeper";
    const playerId = shownResult.keeperPlayerId;
    if (playerId && playerNames[playerId]) {
      return playerNames[playerId];
    }
    return "Keeper";
  }, [shownResult, playerNames]);
  const isTimerUrgent = timer !== null && timer > 0 && timer <= 3;
  const isRevealLocked =
    revealStage === "REVEALING" || revealStage === "REVEALED";

  // Phase 6C — gate `canPick` on the readiness authority. Until
  // `match:status { timeoutSeconds }` arrives, picks are refused.
  // Hotfix: gate uses the authoritative `isStaging` boolean (set
  // on `match:stagingBegin`, cleared by `match:status`) rather
  // than the raw `stagingStartsAt` payload — so a stuck startsAt
  // value never leaves the gate held open.
  const isPreStartGate =
    isStaging ||
    waitingForReturnDeadline !== null ||
    cancelledMessage !== null;

  const canPick =
    playerCount >= 2 &&
    !matchEnded &&
    !hasSubmittedPick &&
    revealStage !== "REVEALING" &&
    revealStage !== "REVEALED" &&
    !isPreStartGate &&
    !!identity;

  const matchEndOutcome = useMemo(() => {
    if (!matchEnded) return null;
    if (myScore > opponentScore) return "victory" as const;
    if (myScore < opponentScore) return "defeat" as const;
    return "draw" as const;
  }, [matchEnded, myScore, opponentScore]);

  const postMatchCopy = useMemo(() => {
    if (!matchEndOutcome) return null;
    return getPostMatchPresentation({
      outcome: matchEndOutcome,
      isTournament: isTournamentMatch,
      isFinal: isFinalTournamentMatch,
      opponentName,
      roundLabel: tournamentRoundDisplayLabel,
    });
  }, [
    matchEndOutcome,
    isTournamentMatch,
    isFinalTournamentMatch,
    opponentName,
    tournamentRoundDisplayLabel,
  ]);

  const showLeaveMatchControls = useMemo(() => {
    return (
      !matchEnded &&
      !matchAborted &&
      !redirectingAfterAbort &&
      playerCount >= 2 &&
      !!identity &&
      matchStartedAt !== null &&
      earlyCancelDeadlineAt !== null &&
      // Phase 6C — hide Forfeit while the readiness authority is
      // gating start. The match hasn't begun in any meaningful
      // sense, so there's nothing to forfeit.
      !isPreStartGate
    );
  }, [
    matchEnded,
    matchAborted,
    redirectingAfterAbort,
    playerCount,
    identity,
    matchStartedAt,
    earlyCancelDeadlineAt,
    isPreStartGate,
  ]);

  const isEarlyCancelWindow = useMemo(() => {
    if (isTournamentMatch) return false;
    if (earlyCancelDeadlineAt === null) return false;
    return nowMs < earlyCancelDeadlineAt;
  }, [isTournamentMatch, earlyCancelDeadlineAt, nowMs]);

  const earlyCancelSecondsLeft = useMemo(() => {
    if (earlyCancelDeadlineAt === null) return 0;
    return Math.max(0, Math.ceil((earlyCancelDeadlineAt - nowMs) / 1000));
  }, [earlyCancelDeadlineAt, nowMs]);

  function pick(lane: Lane) {
    if (!canPick || !identity) return;

    // Hotfix Sprint TASK 4: client-side defence-in-depth. The server
    // is the authoritative validator (see
    // apps/realtime-server/src/security/validation.ts), but a fast
    // client check avoids emitting a doomed pick that would silently
    // be dropped server-side and stall the round timer UX. Any
    // legitimate UI path can only call `pick()` from the LANES list,
    // so this guard fires only on bug or tampered build.
    if (!isValidLane(lane)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[match:pick] refused invalid lane locally", { lane });
      }
      return;
    }

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    clickSound.currentTime = 0;
    void clickSound.play().catch(() => {});

    if (process.env.NODE_ENV !== "production") {
      const myRole = identity ? roles[identity.playerId] ?? null : null;
      console.info("[match:pick] emit", {
        roomCode: normalizedRoomCode,
        playerId: identity.playerId,
        socketId: socket.id,
        role: myRole,
        round,
        phase,
        lane,
        hasPicked: hasSubmittedPick,
        canPick,
      });
    }

    socket.emit("match:pick", {
      roomCode: normalizedRoomCode,
      lane,
      playerId: identity.playerId,
    });

    resolvingPickRoundRef.current = lastPickRoundRef.current ?? round;
    setHasSubmittedPick(true);
    setMyPick(lane);
    setRevealStage("LOCKED");
    // If the opponent is disconnected and the abort grace is still
    // running, the red countdown is the authoritative signal — don't
    // claim we're merely "waiting" / that the opponent is "thinking".
    if (isDisconnectGraceStillActive()) {
      setOpponentStatus("");
      setStatus(`You locked ${lane}. Opponent disconnected.`);
    } else {
      setOpponentStatus("Opponent is thinking...");
      setStatus(`You locked ${lane}. Waiting for opponent...`);
    }
  }

  function requestRematch() {
    if (!identity || rematchRequested) return;

    const socket = getSocket();

    socket.emit("match:rematch", {
      roomCode,
      playerId: identity.playerId,
    });

    setRematchRequested(true);
    setStatus("Waiting for opponent...");
  }

  function declineRematch() {
    if (!identity) return;

    const socket = getSocket();

    socket.emit("match:rematch:decline", {
      roomCode,
      playerId: identity.playerId,
    });
  }

  function abortEarlyMatch() {
    if (!identity || leaveMatchBusy || !showLeaveMatchControls) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Try again in a second.");
      return;
    }

    setLeaveMatchBusy(true);
    setStatus("Cancelling match...");

    socket.emit("match:abortEarly", {
      roomCode,
      playerId: identity.playerId,
    });
  }

  function forfeitMatch() {
    if (!identity || leaveMatchBusy || !showLeaveMatchControls) return;

    const confirmed = window.confirm(
      "Forfeit this match? This will count as a loss."
    );

    if (!confirmed) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Try again in a second.");
      return;
    }

    setLeaveMatchBusy(true);
    setStatus("Forfeiting match...");

    socket.emit("match:forfeit", {
      roomCode,
      playerId: identity.playerId,
    });
  }

  const showTournamentStaging =
    isTournamentMatch && tournamentStagingCountdown !== null;

  const presentationAccent = accentForContext({
    isTournament: isTournamentMatch,
    isFinal: isFinalTournamentMatch,
  });

  const opponentRoleNow: Role | null = opponentId
    ? roles[opponentId] ?? null
    : null;

  const tensionCountdown = useMemo(() => {
    void tensionTick;
    if (revealStage !== "REVEALING" || revealingStartedAtRef.current === null) {
      return null;
    }
    const elapsed = Date.now() - revealingStartedAtRef.current;
    if (elapsed < 400) return null;
    if (elapsed < 700) return 3;
    if (elapsed < 1000) return 2;
    if (elapsed < 1300) return 1;
    return null;
  }, [revealStage, tensionTick]);

  const myRoleNow: Role | null = myPlayerId ? roles[myPlayerId] ?? null : null;
  const myFirstRoleLabel =
    myRoleNow === "KICKER"
      ? "You are Kicker first"
      : myRoleNow === "KEEPER"
        ? "You are Keeper first"
        : "Roles set in a moment";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MATCH_PRESENTATION_CSS }} />
      <MatchAtmosphereLayer
        accent={presentationAccent}
        intense={isSuddenDeath || isFinalTournamentMatch}
      />
      <MatchStagingScreen
        visible={showTournamentStaging}
        title={tournamentRoundDisplayLabel ?? "Match starting"}
        tournamentName={
          isFinalTournamentMatch ? "Championship" : isTournamentMatch ? "Tournament" : null
        }
        leftName={myName}
        rightName={opponentName}
        seconds={tournamentStagingCountdown}
        accent={presentationAccent}
      />
      {roundTransition ? (
        <RoundTransition
          visible
          kind={roundTransition.kind}
          label={roundTransition.label}
          sublabel={roundTransition.sublabel}
          accent={presentationAccent}
        />
      ) : null}
      <MatchResultOverlay
        visible={resultBurstResult !== null}
        result={resultBurstResult}
      />
      {/* Phase 6C — pre-start readiness overlay. Covers four states:
            • waiting for opponent to join (1 player in room)
            • waiting for opponent to return (2 slots, opponent absent)
            • staging (both present; cleared by `match:status` with `timeoutSeconds`)
            • cancelled (room torn down by readiness authority)
          Hotfix: staging branch is gated on `isStaging` (the
          authoritative server-driven flag) rather than the raw
          `stagingStartsAt`, and no longer renders a client-ticked
          numeric countdown — that was the source of "stuck at 0"
          and "staging overlay persists after gameplay started"
          bugs. */}
      {cancelledMessage !== null ||
      isStaging ||
      waitingForReturnDeadline !== null ||
      (playerCount < 2 && !matchEnded) ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-6 backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/85 px-6 py-7 text-center shadow-2xl">
            {cancelledMessage !== null ? (
              <>
                <p className="text-xs font-black uppercase tracking-[0.32em] text-red-300/90">
                  Match cancelled
                </p>
                <p className="mt-3 text-base text-zinc-100">
                  {cancelledMessage}
                </p>
                <p className="mt-2 text-xs text-zinc-400">
                  Returning to lobby...
                </p>
              </>
            ) : isStaging ? (
              <>
                <p className="text-xs font-black uppercase tracking-[0.32em] text-emerald-300/90">
                  Both players ready
                </p>
                <p className="mt-4 text-3xl font-black tracking-tight text-white">
                  Match starting...
                </p>
                <p className="mt-3 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                  Get ready
                </p>
              </>
            ) : waitingForReturnDeadline !== null ? (
              <>
                <p className="text-xs font-black uppercase tracking-[0.32em] text-amber-300/90">
                  Waiting for opponent
                </p>
                <p className="mt-3 text-sm text-zinc-300">
                  {absentOpponentName
                    ? `${absentOpponentName} stepped away. Holding until they return.`
                    : "Holding the match until your opponent returns."}
                </p>
                <p className="mt-4 text-5xl font-black tabular-nums text-white">
                  {returnSecondsRemaining ?? "—"}s
                </p>
                <p className="mt-3 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                  No penalty if cancelled
                </p>
              </>
            ) : (
              <WaitingForOpponentCard roomCode={normalizedRoomCode} />
            )}
          </div>
        </div>
      ) : null}
      <div
        className={`relative z-10 main-container mx-auto max-w-6xl space-y-6 px-3 py-5 text-white sm:space-y-8 sm:px-4 sm:py-8 md:space-y-10 md:px-6 md:py-10 ${
          screenEffect === "GOAL"
            ? "zoom-impact scale-[1.06] transition-transform duration-300 ease-out ring-2 ring-green-400/80 shadow-[0_0_40px_rgba(34,197,94,0.55)]"
            : screenEffect === "SAVE"
              ? "shake-impact ring-2 ring-sky-500 shadow-[0_0_36px_rgba(56,189,248,0.55)] match-screen-shake"
              : screenEffect === "DRAW"
                ? "soft-impact scale-[1.03] transition-transform duration-300 ease-out ring-1 ring-zinc-300/90 shadow-[0_0_28px_rgba(212,212,216,0.45)]"
                : isSuddenDeath
                  ? "rounded-[2rem] border border-yellow-400/45 bg-yellow-500/10 shadow-[0_0_28px_rgba(234,179,8,0.14)]"
                  : isLateGame
                    ? "rounded-[2rem] border border-red-400/35 bg-red-500/5 shadow-[0_0_22px_rgba(248,113,113,0.08)]"
                    : ""
        }`}
      >
      <section
        className={`match-container overflow-hidden rounded-[2rem] border bg-gradient-to-br shadow-2xl transition-all duration-300 ease-out ${
          impactResult === "GOAL"
            ? "border-zinc-800 from-zinc-950 via-zinc-900 to-black goal-flash ring-4 ring-green-400 scale-[1.05] shadow-[0_0_44px_rgba(34,197,94,0.65)]"
            : impactResult === "SAVE"
              ? "border-zinc-800 from-zinc-950 via-zinc-900 to-black save-flash ring-4 ring-orange-500 scale-[1.04] shadow-[0_0_40px_rgba(249,115,22,0.6)]"
              : impactResult === "DRAW"
                ? "border-zinc-800 from-zinc-950 via-zinc-900 to-black draw-flash ring-2 ring-zinc-300 scale-[1.03] shadow-[0_0_32px_rgba(212,212,216,0.5)]"
                : isSuddenDeath
                  ? "border-yellow-500/50 from-yellow-950/25 via-zinc-900 to-black shadow-[0_0_36px_rgba(234,179,8,0.14)]"
                  : isLateGame
                    ? "border-red-400/40 from-zinc-950 via-zinc-900 to-black shadow-[0_0_30px_rgba(248,113,113,0.1)]"
                    : "border-zinc-800 from-zinc-950 via-zinc-900 to-black"
        }`}
      >
        <div className="border-b border-zinc-800 px-4 py-4 md:px-6 md:py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 font-black uppercase tracking-[0.2em] ${
                    isSuddenDeath
                      ? "bg-amber-400 px-4 py-1.5 text-sm text-black shadow-[0_0_18px_rgba(251,191,36,0.45)]"
                      : "bg-emerald-400 text-xs text-black"
                  }`}
                >
                  {phaseLabel}
                </span>

                <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-bold text-zinc-300">
                  Room {roomCode}
                </span>

                {isTournamentMatch ? (
                  <span
                    className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                      isFinalTournamentMatch
                        ? "border-yellow-300/60 bg-yellow-500/15 text-yellow-100 shadow-[0_0_18px_rgba(234,179,8,0.25)]"
                        : "border-amber-500/45 bg-amber-950/40 text-amber-200"
                    }`}
                  >
                    {isFinalTournamentMatch
                      ? "🏆 Championship"
                      : tournamentRoundDisplayLabel ?? "Tournament"}
                  </span>
                ) : null}

                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    connected
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-red-500/15 text-red-300"
                  }`}
                >
                  {connected ? "Online" : "Offline"}
                </span>
              </div>

              {tournamentIntroVisible && isTournamentMatch ? (
                <div
                  className={`tournament-intro-pill mt-3 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 ${
                    isFinalTournamentMatch
                      ? "border-yellow-300/55 bg-yellow-500/10 text-yellow-100"
                      : "border-amber-500/40 bg-amber-950/30 text-amber-100"
                  }`}
                  aria-live="polite"
                >
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] opacity-90">
                    {tournamentRoundDisplayLabel ?? "Tournament"}
                  </span>
                  <span className="text-sm font-bold">
                    {myFirstRoleLabel}
                  </span>
                  <span className="text-xs font-semibold opacity-80">
                    · First to finish the shootout advances
                  </span>
                </div>
              ) : null}
              <h1 className="mt-3 break-words text-2xl font-black sm:text-3xl md:mt-4 md:text-5xl">
                {myName}{" "}
                <span
                  className={
                    isSuddenDeath
                      ? "text-amber-200/90"
                      : isLateGame
                        ? "text-zinc-300"
                        : "text-zinc-500"
                  }
                >
                  vs
                </span>{" "}
                {opponentName}
              </h1>

              <p
                className={`mt-3 max-w-2xl text-sm ${
                  isSuddenDeath
                    ? "text-zinc-100"
                    : isLateGame
                      ? "text-zinc-200"
                      : "text-zinc-400"
                }`}
              >
                {status}
              </p>
              {opponentStatus ? (
                <p className="mt-1 text-xs font-semibold text-amber-300/85">
                  {opponentStatus}
                </p>
              ) : null}
              {disconnectCountdown !== null ? (
                <div className="mt-2 max-w-2xl rounded-xl border border-red-500/40 bg-red-950/35 px-3 py-2">
                  <p className="text-sm font-semibold text-red-200">
                    Opponent disconnected. Aborting match in{" "}
                    {disconnectCountdown}s...
                  </p>
                </div>
              ) : null}

              {showLeaveMatchControls ? (
                <div className="mt-3 flex max-w-2xl flex-wrap items-center gap-3">
                  {isEarlyCancelWindow ? (
                    <button
                      type="button"
                      onClick={abortEarlyMatch}
                      disabled={leaveMatchBusy}
                      className="rounded-xl border border-zinc-500 bg-zinc-900 px-4 py-2 text-sm font-bold text-zinc-100 hover:border-zinc-300 disabled:opacity-50"
                    >
                      {leaveMatchBusy ? "Cancelling..." : "Cancel Match"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={forfeitMatch}
                      disabled={leaveMatchBusy}
                      className="rounded-xl border border-red-500/50 bg-red-950/40 px-4 py-2 text-sm font-bold text-red-100 hover:border-red-400/70 disabled:opacity-50"
                    >
                      {leaveMatchBusy ? "Leaving..." : "Forfeit"}
                    </button>
                  )}
                  {isEarlyCancelWindow ? (
                    <span className="text-xs text-zinc-400">
                      No penalty for {earlyCancelSecondsLeft}s
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">
                      Counts as a loss
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            <div
              className={`w-full self-stretch rounded-3xl border px-5 py-4 text-center shadow-lg transition-all duration-300 md:w-auto md:min-w-[9.5rem] md:self-auto md:px-6 md:py-5 ${
                isTimerUrgent
                  ? "match-timer-urgent border-red-400/90 bg-red-500/20"
                  : isSuddenDeath
                    ? "match-timer-sudden-death border-yellow-400/80 bg-yellow-500/15"
                    : "border-zinc-700 bg-zinc-900"
              }`}
            >
              <p
                className={`text-xs font-black uppercase tracking-[0.22em] ${
                  isTimerUrgent
                    ? "text-red-200"
                    : isSuddenDeath
                      ? "text-yellow-200/90"
                      : "text-zinc-400"
                }`}
              >
                {isTimerUrgent ? "Lock in!" : "Timer"}
              </p>
              <p
                className={`mt-1 text-5xl font-black tabular-nums transition-transform duration-300 md:text-6xl ${
                  isTimerUrgent
                    ? "text-red-200"
                    : isSuddenDeath
                      ? "text-yellow-100"
                      : "text-white"
                }`}
              >
                {timer !== null ? timer : "—"}
              </p>
              <p
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  isTimerUrgent
                    ? "text-red-200/85"
                    : isSuddenDeath
                      ? "text-yellow-200/70"
                      : "text-zinc-500"
                }`}
              >
                {isTimerUrgent ? "Hurry" : "seconds"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 md:gap-4 md:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-black/40 p-3 md:rounded-3xl md:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
              Your Role
            </p>
            <p className="mt-2 text-xl font-black md:mt-3 md:text-2xl">
              {myRole || "—"}
            </p>
          </div>

          <div
            className={`rounded-2xl border bg-black/40 p-3 md:rounded-3xl md:p-5 ${
              isSuddenDeath
                ? "border-amber-400/45 shadow-[inset_0_0_24px_rgba(251,191,36,0.06)]"
                : isLateGame
                  ? "border-red-400/30"
                  : "border-zinc-800"
            }`}
          >
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.18em] md:text-xs ${
                isSuddenDeath
                  ? "text-amber-300/90"
                  : isLateGame
                    ? "text-zinc-300"
                    : "text-zinc-500"
              }`}
            >
              Round
            </p>
            <p
              className={`mt-2 font-black md:mt-3 ${
                isSuddenDeath
                  ? "text-2xl text-amber-200 md:text-4xl"
                  : isLateGame
                    ? "text-xl text-zinc-100 md:text-2xl"
                    : "text-xl md:text-2xl"
              }`}
            >
              {roundLabel}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-black/40 p-3 md:rounded-3xl md:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
              Players
            </p>
            <p className="mt-2 text-xl font-black md:mt-3 md:text-2xl">
              {playerCount}/2
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-black/40 p-3 md:rounded-3xl md:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
              Pick Status
            </p>
            <p className="mt-2 text-xl font-black md:mt-3 md:text-2xl">
              {revealStage === "LOCKED"
                ? "Locked"
                : revealStage === "REVEALING"
                  ? "Revealing"
                  : revealStage === "REVEALED"
                    ? "Revealed"
                    : "Open"}
            </p>
          </div>
        </div>
      </section>

      {isSuddenDeath && !matchEnded ? (
        <section className="rounded-3xl border border-yellow-400 bg-yellow-500/10 p-5 shadow-xl sm:p-6 md:rounded-[2rem]">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-yellow-300 sm:text-sm">
            Sudden Death
          </p>
          <h2 className="mt-2 text-2xl font-black sm:text-3xl">
            One clean cycle decides everything.
          </h2>
          <p className="mt-2 text-sm text-yellow-100 sm:text-base">
            Both players were tied after normal rounds. Score while your
            opponent fails and the match ends.
          </p>
        </section>
      ) : null}

      <MatchScoreboard
        myName={myName}
        opponentName={opponentName}
        myScore={myScore}
        opponentScore={opponentScore}
        myRole={myRoleNow}
        opponentRole={opponentRoleNow}
        scorePulse={scorePulse}
        isSuddenDeath={isSuddenDeath}
        isTournament={isTournamentMatch}
        isFinal={isFinalTournamentMatch}
      />

      {!matchEnded ? (
        <section className="relative rounded-[2rem] border border-zinc-800 bg-zinc-900/95 p-5 shadow-xl md:p-7">
          {revealStage === "LOCKED" && !isRevealLocked ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[2rem] bg-black/50 backdrop-blur-[2px]"
              aria-live="polite"
            >
              <div className="p444-pick-locked-pulse rounded-2xl border border-cyan-400/50 bg-cyan-950/40 px-6 py-4 text-center shadow-[0_0_32px_rgba(56,189,248,0.25)]">
                <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-300">
                  Pick locked
                </p>
                <p className="mt-1 text-lg font-black text-white">
                  {disconnectCountdown !== null
                    ? "Opponent disconnected"
                    : "Waiting for opponent…"}
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black md:text-3xl">
                {revealStage === "LOCKED"
                  ? "Pick locked"
                  : hasSubmittedPick || myPick
                    ? "Pick locked in"
                    : "Choose your lane"}
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                {hasSubmittedPick || myPick
                  ? `You picked ${myPick ?? "your lane"}.`
                  : myRole === "KICKER"
                    ? "Pick LEFT, CENTER, or RIGHT before the timer expires."
                    : myRole === "KEEPER"
                      ? "Guess the kicker's lane before the timer expires."
                      : "Pick LEFT, CENTER, or RIGHT before the timer expires."}
              </p>
              {(hasSubmittedPick || myPick) &&
              !isRevealLocked &&
              disconnectCountdown === null ? (
                <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-emerald-300"
                    aria-hidden
                  />
                  Waiting for opponent
                  <span className="match-waiting-dots" aria-hidden>
                    <span className="match-waiting-dot" />
                    <span className="match-waiting-dot" />
                    <span className="match-waiting-dot" />
                  </span>
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-end">
              {myRole ? (
                <span
                  className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                    myRole === "KICKER"
                      ? "border-amber-400/60 bg-amber-500/10 text-amber-100"
                      : "border-sky-400/60 bg-sky-500/10 text-sky-100"
                  }`}
                >
                  Playing as {myRole}
                </span>
              ) : null}
              {opponentStatus && !isRevealLocked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">
                  <span
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300"
                    aria-hidden
                  />
                  Opponent locked
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:mt-7 md:grid-cols-3">
            {LANES.map((lane) => (
              <button
                key={lane}
                onClick={() => pick(lane)}
                disabled={!canPick}
                aria-pressed={myPick === lane}
                className={`group rounded-3xl border px-5 py-7 text-center md:py-8 ${getLaneButtonClass(
                  lane,
                  {
                    canPick,
                    myPick,
                    isSuddenDeath,
                    revealStage,
                  }
                )}`}
              >
                <p className="text-5xl font-black md:text-6xl">
                  {laneEmoji(lane)}
                </p>
                <p className="mt-3 text-lg font-black md:text-xl">{lane}</p>
                {myPick === lane ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/25 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-100 ring-1 ring-emerald-300/60">
                    <span aria-hidden>✓</span> Locked in
                  </p>
                ) : isRevealLocked ? (
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                    Reveal in progress
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className={`rounded-[2rem] border p-5 shadow-2xl transition-all duration-300 md:p-7 ${resultStyle(
          shownResult?.result
        )} ${
          revealStage === "REVEALED"
            ? "match-result-reveal-done"
            : revealStage === "REVEALING"
              ? "match-result-reveal-active"
              : ""
        }`}
        aria-live="polite"
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="md:max-w-xl">
            <p className="text-xs font-black uppercase tracking-[0.25em] text-white/60">
              {shownResult?.round
                ? `Round ${shownResult.round} · Result`
                : "Current result"}
            </p>

            <h2
              className={`mt-3 inline-flex items-center gap-3 text-4xl font-black transition-all duration-300 sm:text-5xl md:text-7xl ${resultHeadlineClass(
                shownResult?.result,
                revealStage
              )}`}
            >
              {revealStage === "REVEALING" ? (
                tensionCountdown !== null ? (
                  <span
                    key={tensionCountdown}
                    className="tabular-nums text-white drop-shadow-[0_0_28px_rgba(56,189,248,0.45)]"
                  >
                    {tensionCountdown}
                  </span>
                ) : (
                  <span className="text-2xl uppercase tracking-[0.22em] text-cyan-200/90 md:text-3xl">
                    Pick locked
                  </span>
                )
              ) : (
                <>
                  {shownResult?.result ? (
                    <span aria-hidden className="text-3xl md:text-5xl">
                      {resultEmoji(shownResult.result)}
                    </span>
                  ) : null}
                  <span>{resultLabel(shownResult?.result)}</span>
                </>
              )}
            </h2>

            {revealStage !== "REVEALING" && shownResult?.result ? (
              <p className="mt-2 text-sm font-bold uppercase tracking-[0.18em] text-white/80 md:text-base">
                {resultSubheadline(shownResult.result)}
              </p>
            ) : null}

            {revealStage !== "REVEALING" && resultFlavorMessage ? (
              <p className="mt-2 text-sm font-medium italic text-white/65">
                {resultFlavorMessage}
              </p>
            ) : null}

            {shownResult?.statusMessage ? (
              <p className="mt-3 text-sm text-white/80">
                {shownResult.statusMessage}
              </p>
            ) : null}

            {revealStage === "REVEALED" && !matchEnded && shownResult?.result ? (
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/30 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.22em] text-white/85">
                <span className="match-waiting-dots" aria-hidden>
                  <span className="match-waiting-dot" />
                  <span className="match-waiting-dot" />
                  <span className="match-waiting-dot" />
                </span>
                Next round · Roles switching
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 md:w-[440px] md:gap-4">
            <div
              className={`rounded-2xl border bg-black/25 p-4 transition-all duration-300 ${
                shownResult?.result === "GOAL"
                  ? "border-emerald-300/40 shadow-[0_0_24px_rgba(52,211,153,0.18)]"
                  : shownResult?.result === "SAVE"
                    ? "border-sky-300/35 shadow-[0_0_24px_rgba(56,189,248,0.16)]"
                    : shownResult?.result === "DRAW"
                      ? "border-yellow-300/35 shadow-[0_0_22px_rgba(250,204,21,0.14)]"
                      : "border-white/10"
              } ${revealStage === "REVEALED" ? "scale-[1.04]" : ""}`}
            >
              <p className="text-xs uppercase tracking-[0.18em] text-white/55">
                {kickerResultLabel}
                <span className="ml-1 text-white/40">· Kicker</span>
              </p>
              <p className="mt-2 text-3xl font-black md:text-4xl">
                {shownResult?.kickerPick
                  ? `${laneEmoji(shownResult.kickerPick)} ${
                      shownResult.kickerPick
                    }`
                  : "—"}
              </p>
            </div>

            <div
              className={`rounded-2xl border bg-black/25 p-4 transition-all duration-300 ${
                shownResult?.result === "GOAL"
                  ? "border-emerald-300/40 shadow-[0_0_24px_rgba(52,211,153,0.18)]"
                  : shownResult?.result === "SAVE"
                    ? "border-sky-300/35 shadow-[0_0_24px_rgba(56,189,248,0.16)]"
                    : shownResult?.result === "DRAW"
                      ? "border-yellow-300/35 shadow-[0_0_22px_rgba(250,204,21,0.14)]"
                      : "border-white/10"
              } ${revealStage === "REVEALED" ? "scale-[1.04]" : ""}`}
            >
              <p className="text-xs uppercase tracking-[0.18em] text-white/55">
                {keeperResultLabel}
                <span className="ml-1 text-white/40">· Keeper</span>
              </p>
              <p className="mt-2 text-3xl font-black md:text-4xl">
                {shownResult?.keeperPick
                  ? `${laneEmoji(shownResult.keeperPick)} ${
                      shownResult.keeperPick
                    }`
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {matchEnded && matchEndOutcome ? (
        <section
          className={`rounded-3xl border p-5 shadow-2xl sm:p-7 md:rounded-[2rem] md:p-10 ${
            matchEndOutcome === "victory"
              ? "border-emerald-400/70 bg-gradient-to-br from-emerald-950/55 via-zinc-950 to-amber-950/35 ring-2 ring-emerald-400/25 shadow-[0_0_48px_rgba(16,185,129,0.22)]"
              : matchEndOutcome === "defeat"
                ? "border-red-500/55 bg-gradient-to-br from-red-950/45 via-zinc-950 to-zinc-950 ring-2 ring-red-500/20 shadow-[0_0_40px_rgba(239,68,68,0.15)]"
                : "border-yellow-400/55 bg-gradient-to-br from-yellow-950/30 via-zinc-950 to-zinc-900 ring-2 ring-yellow-400/20 shadow-[0_0_36px_rgba(234,179,8,0.14)]"
          }`}
        >
          <p
            className={`text-xs font-black uppercase tracking-[0.3em] ${
              matchEndOutcome === "victory"
                ? "text-emerald-300/90"
                : matchEndOutcome === "defeat"
                  ? "text-red-300/90"
                  : "text-yellow-200/90"
            }`}
          >
            {postMatchCopy?.eyebrow ?? "Match Complete"}
          </p>

          {postMatchCopy?.progression ? (
            <p
              className={`mt-4 text-[11px] font-black uppercase tracking-[0.28em] ${
                matchEndOutcome === "victory"
                  ? isFinalTournamentMatch
                    ? "text-yellow-300"
                    : "text-amber-300"
                  : matchEndOutcome === "defeat"
                    ? "text-red-300/90"
                    : "text-yellow-200/90"
              }`}
            >
              {postMatchCopy.progression}
            </p>
          ) : null}

          <h2
            className={`mt-2 break-words text-4xl font-black uppercase tracking-tight sm:text-5xl md:mt-3 md:text-6xl ${
              isFinalTournamentMatch && matchEndOutcome === "victory"
                ? "bg-gradient-to-r from-yellow-200 via-amber-200 to-orange-200 bg-clip-text text-transparent drop-shadow-[0_0_32px_rgba(234,179,8,0.5)]"
                : matchEndOutcome === "victory"
                  ? "bg-gradient-to-r from-emerald-200 via-emerald-100 to-cyan-200 bg-clip-text text-transparent drop-shadow-[0_0_24px_rgba(52,211,153,0.35)]"
                  : matchEndOutcome === "defeat"
                    ? "text-red-100 drop-shadow-[0_0_20px_rgba(248,113,113,0.25)]"
                    : "text-yellow-100 drop-shadow-[0_0_18px_rgba(250,204,21,0.2)]"
            }`}
          >
            {postMatchCopy?.headline ?? "Match Complete"}
          </h2>

          <p
            className={`mt-3 max-w-xl text-base font-semibold leading-relaxed md:text-lg ${
              isFinalTournamentMatch && matchEndOutcome === "victory"
                ? "text-yellow-100"
                : matchEndOutcome === "victory"
                  ? "text-emerald-100/90"
                  : matchEndOutcome === "defeat"
                    ? "text-zinc-300"
                    : "text-yellow-100/85"
            }`}
          >
            {postMatchCopy?.subline ?? ""}
          </p>

          <div
            className={`mt-8 rounded-2xl border px-6 py-6 md:px-8 md:py-8 ${
              matchEndOutcome === "victory"
                ? "border-emerald-400/30 bg-black/35"
                : matchEndOutcome === "defeat"
                  ? "border-red-500/25 bg-black/40"
                  : "border-yellow-400/25 bg-black/35"
            }`}
          >
            <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
              Final score
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-center sm:gap-4 md:mt-4 md:gap-8">
              <div className="min-w-[5rem] sm:min-w-[7rem]">
                <p className="truncate text-xs font-semibold text-zinc-400 sm:text-sm">
                  {myName}
                </p>
                <p className="mt-1 text-5xl font-black tabular-nums text-white sm:text-6xl md:text-8xl">
                  {myScore}
                </p>
              </div>
              <span className="text-3xl font-black text-zinc-600 sm:text-4xl md:text-5xl">
                —
              </span>
              <div className="min-w-[5rem] sm:min-w-[7rem]">
                <p className="truncate text-xs font-semibold text-zinc-400 sm:text-sm">
                  {opponentName}
                </p>
                <p className="mt-1 text-5xl font-black tabular-nums text-white sm:text-6xl md:text-8xl">
                  {opponentScore}
                </p>
              </div>
            </div>
          </div>

          {!isTournamentMatch ? (
            <p className="mt-6 text-sm text-zinc-400">
              Rematch votes: {rematchVotes}/{rematchRequired}
            </p>
          ) : null}

          {!isTournamentMatch && rematchDeclinedBy && rematchDeclinedBy !== myPlayerId ? (
            <p className="mt-3 text-sm font-semibold text-zinc-200">
              Opponent declined rematch.
            </p>
          ) : null}
          {!isTournamentMatch && rematchDeclinedBy && rematchDeclinedBy === myPlayerId ? (
            <p className="mt-3 text-sm font-semibold text-zinc-200">
              You declined rematch.
            </p>
          ) : null}

          {!isTournamentMatch &&
          rematchRequested &&
          rematchVotes < rematchRequired &&
          !rematchDeclinedBy ? (
            <p className="mt-3 text-sm font-semibold text-zinc-300">
              Waiting for opponent...
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            {!isTournamentMatch && showOpponentRematchPrompt ? (
              <div className="flex w-full flex-col gap-3 md:max-w-md">
                <p className="text-center text-sm font-semibold text-zinc-100 md:text-left">
                  Opponent requested a rematch
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={requestRematch}
                    disabled={!identity}
                    className="rounded-2xl bg-white px-5 py-4 font-black text-black disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={declineRematch}
                    disabled={!identity}
                    className="rounded-2xl border border-white/35 px-5 py-4 font-black text-white hover:bg-white/10 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : !isTournamentMatch ? (
              <button
                type="button"
                onClick={requestRematch}
                disabled={rematchRequested || !identity}
                className="rounded-2xl bg-white px-5 py-4 font-black text-black disabled:opacity-50"
              >
                {rematchRequested ? "Rematch Requested" : "Rematch"}
              </button>
            ) : null}

            {opponentName && opponentName !== "Opponent" ? (
              <Link
                href={`/profile/${encodeURIComponent(opponentName)}`}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-zinc-700 bg-black/40 px-5 py-4 text-center text-sm font-black uppercase tracking-wider text-zinc-200 transition-colors hover:border-cyan-400/55 hover:text-cyan-100"
              >
                <span aria-hidden>👤</span>
                View Opponent
              </Link>
            ) : null}

            {!isTournamentMatch &&
            opponentName &&
            opponentName !== "Opponent" ? (
              <Link
                href={`/lobby?challenge=${encodeURIComponent(opponentName)}`}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-cyan-500/45 bg-cyan-500/10 px-5 py-4 text-center text-sm font-black uppercase tracking-wider text-cyan-100 transition-colors hover:bg-cyan-500/20"
              >
                <span aria-hidden>⚔</span>
                Challenge Again
              </Link>
            ) : null}

            {isTournamentMatch && tournamentId ? (
              <div
                className={`flex w-full flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between ${
                  isFinalTournamentMatch && matchEndOutcome === "victory"
                    ? "border-yellow-300/55 bg-gradient-to-r from-yellow-900/35 via-amber-950/30 to-black shadow-[0_0_28px_rgba(234,179,8,0.22)]"
                    : matchEndOutcome === "victory"
                      ? "border-emerald-400/40 bg-emerald-950/30"
                      : matchEndOutcome === "defeat"
                        ? "border-red-500/30 bg-red-950/25"
                        : "border-yellow-400/30 bg-yellow-950/20"
                }`}
                aria-live="polite"
              >
                <div className="flex flex-col gap-1">
                  <p
                    className={`text-xs font-black uppercase tracking-[0.25em] ${
                      isFinalTournamentMatch && matchEndOutcome === "victory"
                        ? "text-yellow-200"
                        : matchEndOutcome === "victory"
                          ? "text-emerald-300/90"
                          : matchEndOutcome === "defeat"
                            ? "text-red-300/90"
                            : "text-yellow-200/90"
                    }`}
                  >
                    {isFinalTournamentMatch && matchEndOutcome === "victory"
                      ? "🏆 Champion"
                      : matchEndOutcome === "victory"
                        ? "You advanced"
                        : matchEndOutcome === "defeat"
                          ? "Eliminated"
                          : "Match drawn"}
                  </p>
                  {tournamentRedirectCountdown !== null ? (
                    <p className="inline-flex items-baseline gap-2 text-sm font-semibold text-zinc-200">
                      {isFinalTournamentMatch && matchEndOutcome === "victory"
                        ? "Champion moment on tournament page in"
                        : matchEndOutcome === "victory"
                          ? "Returning to tournament in"
                          : matchEndOutcome === "defeat"
                            ? "Returning to tournament in"
                            : "Returning to tournament in"}
                      <span className="text-2xl font-black tabular-nums text-white">
                        {tournamentRedirectCountdown}s
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-zinc-200">
                      Returning to tournament…
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearActiveMatch();
                    router.push(`/tournaments/${tournamentId}`);
                  }}
                  className={`rounded-2xl px-5 py-3 font-black shadow-lg ${
                    isFinalTournamentMatch && matchEndOutcome === "victory"
                      ? "bg-gradient-to-r from-yellow-300 to-amber-500 text-zinc-950 hover:from-yellow-200 hover:to-amber-400"
                      : "bg-gradient-to-r from-amber-500 to-orange-600 text-zinc-950 hover:from-amber-400 hover:to-orange-500"
                  }`}
                >
                  {isFinalTournamentMatch && matchEndOutcome === "victory"
                    ? "Open Tournament →"
                    : "Back to Tournament →"}
                </button>
              </div>
            ) : (
              <a
                href="/lobby"
                className="rounded-2xl border border-white/30 px-5 py-4 text-center font-black text-white hover:bg-white hover:text-black"
              >
                Back to Lobby
              </a>
            )}
          </div>
        </section>
      ) : null}
      </div>

      {matchAborted ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-labelledby="match-aborted-title"
          aria-describedby="match-aborted-desc"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-600 bg-zinc-950 px-8 py-10 text-center shadow-2xl">
            <h2
              id="match-aborted-title"
              className="text-2xl font-black tracking-tight text-white"
            >
              Match Cancelled
            </h2>
            <p
              id="match-aborted-desc"
              className="mt-3 text-sm leading-relaxed text-zinc-300"
            >
              {matchAbortedMessage ??
                "No penalty applied. Stakes refunded."}
            </p>
            {redirectingAfterAbort ? (
              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Returning to lobby...
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}