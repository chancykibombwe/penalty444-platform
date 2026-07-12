"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getSocket,
  isSocketEventForRoom,
  waitForSocketAuth,
} from "../../lib/socket/client";
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
import MatchRenderer3D, { type UnityInbound } from "./MatchRenderer3D";

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
  // Server-set on reconnect timer resumes (resumePickTimer). When true,
  // the pick window is continuing for the CURRENT round — clients must
  // NOT reset pick state (hasSubmittedPick, myPick) for players who
  // already locked a pick before the opponent disconnected.
  isResume?: boolean;
  round?: number;
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
    return "match-lane-locked scale-[1.05] border-emerald-300 bg-emerald-500/25 text-emerald-50 shadow-[0_0_40px_rgba(52,211,153,0.5)] ring-2 ring-emerald-300/80";
  }

  if (!canPick || isRevealLocked) {
    return "match-lane-disabled cursor-not-allowed border-zinc-800/80 bg-black/20 text-zinc-600 opacity-40";
  }

  if (isLocked) {
    return "match-lane-muted cursor-not-allowed border-zinc-800 bg-black/25 text-zinc-500 opacity-50";
  }

  if (isSuddenDeath) {
    return "match-lane-ready border-yellow-500/60 bg-black/40 text-yellow-50 hover:-translate-y-1 hover:border-yellow-300 hover:bg-yellow-400/20 hover:text-yellow-50 hover:shadow-[0_0_24px_rgba(234,179,8,0.3)] active:scale-[0.97] transition-all duration-150";
  }

  return "match-lane-ready border-zinc-700/80 bg-black/40 text-white hover:-translate-y-1 hover:border-cyan-400/70 hover:bg-cyan-500/10 hover:text-cyan-50 hover:shadow-[0_0_20px_rgba(56,189,248,0.2)] active:scale-[0.97] transition-all duration-150";
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

/**
 * Presentation-only classification of an ALREADY-ENDED match for the optional
 * Unity shadow preview (B5B2). The realtime server has already decided the match
 * is over and persisted the winner; this reads the final authoritative score
 * snapshot purely to pick a winnerId / isDraw for Unity's MATCH OVER / MATCH DRAW
 * banner. It never decides whether the match ends and never mutates scores.
 *
 * Returns null (→ no Unity match_end sent, React unaffected) for a malformed
 * snapshot or fewer than two valid numeric entries.
 */
type UnityMatchEndPresentation = {
  winnerId: string | null;
  isDraw: boolean;
};

function getUnityMatchEndPresentation(
  scores: Record<string, number>
): UnityMatchEndPresentation | null {
  if (!scores || typeof scores !== "object") return null;

  const entries = Object.entries(scores).filter(
    ([, value]) => typeof value === "number" && Number.isFinite(value)
  );
  if (entries.length < 2) return null;

  const highest = Math.max(...entries.map(([, value]) => value));
  const leaders = entries.filter(([, value]) => value === highest);

  if (leaders.length === 1) {
    return { winnerId: leaders[0][0], isDraw: false };
  }
  return { winnerId: null, isDraw: true };
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
      <p className="text-[10px] font-black uppercase tracking-[0.32em] text-zinc-400 sm:text-xs">
        Waiting for opponent
      </p>
      <p className="mt-2 text-xs text-zinc-300 sm:mt-3 sm:text-sm">
        Share your room code to start the match.
      </p>
      <p className="mt-3 select-all text-2xl font-black tracking-[0.4em] text-white sm:mt-4 sm:text-3xl">
        {roomCode}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:mt-5">
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

/**
 * Pre-start waiting card for tournament rooms — both players are assigned
 * by the bracket; room-code sharing is not the entry path. Shown when
 * only one assigned player is in the room (playerCount < 2).
 */
function TournamentWaitingForOpponentCard() {
  return (
    <>
      <p className="text-[10px] font-black uppercase tracking-[0.32em] text-amber-300/90 sm:text-xs">
        Waiting for opponent
      </p>
      <p className="mt-2 text-xs text-zinc-300 sm:mt-3 sm:text-sm">
        Your opponent needs to click Enter Match. Waiting for them to join.
      </p>
      <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
        The timer will not start until both players are ready.
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
  // Absolute expiry epoch for the current pick window, set by onMatchStatus.
  // The RAF countdown loop reads this instead of decrementing state, so
  // there is no cumulative drift over a 10-second round.
  const timerDeadlineRef = useRef<number | null>(null);
  // Incremented each time a new timer deadline is set; drives the RAF effect
  // without creating a feedback loop from timer-state updates.
  const [timerTick, setTimerTick] = useState(0);
  // True once the remote opponent has locked their pick this round.
  // Derived from server broadcasts; reset on every round advance.
  const [opponentPicked, setOpponentPicked] = useState(false);
  // True between match:interRound and the next match:status { timeoutSeconds }.
  // Disables lane buttons and shows "Next round…" instead of the countdown.
  const [isInterRound, setIsInterRound] = useState(false);
  // Ref mirror of hasSubmittedPick so socket-handler closures can read it
  // without stale-closure bugs (closures don't list hasSubmittedPick as dep).
  const hasSubmittedPickRef = useRef(false);
  // Immediate lock on the first click — prevents double-tap before React
  // re-renders to flip hasSubmittedPick. Reset when pick state resets.
  const pickInFlightRef = useRef(false);

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
  /** The match:result payload currently mid-reveal. Set on REVEALING entry, cleared after hold. */
  const pendingRevealPayloadRef = useRef<MatchResultPayload | null>(null);
  /** match:end payload deferred when a reveal was in progress on arrival. */
  const deferredMatchEndPayloadRef = useRef<MatchEndPayload | null>(null);

  useEffect(() => {
    revealStageRef.current = revealStage;
  }, [revealStage]);

  useEffect(() => {
    hasSubmittedPickRef.current = hasSubmittedPick;
    // When pick state resets (round advance / match end), also unlock the
    // immediate double-tap guard so the next round's first click goes through.
    if (!hasSubmittedPick) {
      pickInFlightRef.current = false;
    }
  }, [hasSubmittedPick]);

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
    pendingRevealPayloadRef.current = null;
    deferredMatchEndPayloadRef.current = null;
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

  // ── Unity live shadow preview (Phase B5A) — presentation only, default-off ──
  // Two explicit, build-time flags. The optional Unity iframe mounts and
  // receives ONLY accepted, server-resolved round_result events. This never
  // affects React state, timing, scores, picks, or authority.
  const unityShadowEnabled =
    process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true" &&
    process.env.NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true";
  const [unityShadowMessage, setUnityShadowMessage] = useState<{
    id: string;
    message: UnityInbound;
  } | null>(null);
  // Mirror the current authoritative match state into refs so the once-
  // subscribed match:result handler reads fresh values (not stale closure).
  // Passive copies only — no renders, no timing change.
  const liveScoresRef = useRef<Record<string, number>>({});
  const liveMaxRoundsRef = useRef<number>(3);
  const livePhaseRef = useRef<MatchPhase>("NORMAL");
  const liveMatchInstanceRef = useRef<number>(1);
  useEffect(() => {
    // Only mirror while the shadow feature is enabled — zero footprint when off.
    if (!unityShadowEnabled) return;
    liveScoresRef.current = scores;
    liveMaxRoundsRef.current = maxRounds;
    livePhaseRef.current = phase;
    liveMatchInstanceRef.current = matchInstance;
  }, [unityShadowEnabled, scores, maxRounds, phase, matchInstance]);
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
    let effectActive = true;

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
      if (identity) {
        void waitForSocketAuth(5000).then((auth) => {
          if (!effectActive || !identity) return;
          // Only join when the server's verified userId matches the local
          // identity. A null/mismatched userId means auth failed or timed
          // out — emitting room:join would be rejected and the player
          // would remain stuck. Show a safe status and rely on the next
          // reconnect cycle (which re-runs this check) to recover.
          if (auth.userId !== identity.playerId) {
            setStatus("Securing session…");
            return;
          }
          joinRoom(identity);
        });
      }
    }

    function onDisconnect() {
      setConnected(false);
      setStatus("Disconnected from server");
      timerDeadlineRef.current = null;
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
        timerDeadlineRef.current = null;
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
      // The reveal pipeline owns all UI state mutations while a result is on
      // screen. ALL `match:update` payloads (including matchEnded:true) are
      // queued here so the GOAL/SAVE/DRAW headline always gets its full hold
      // before any round-advance or match-end state lands. The hold timer in
      // `applyRevealedResult` flushes the deferred payload when it expires.
      if (isRevealActive()) {
        deferredMatchUpdatePayloadRef.current = data;
        console.info(
          "[RevealTiming] match:update queued — reveal active (stage=",
          revealStageRef.current,
          ", round=",
          data.round,
          ", matchEnded=",
          data.matchEnded,
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
        setOpponentPicked(false);
        // pickInFlightRef resets via the hasSubmittedPick sync effect above.
        setRevealStage("IDLE");
      }

      if (data.playerNames) {
        setPlayerNames(data.playerNames);
      }

      if (data.matchEnded) {
        if (matchAbortedRef.current) {
          console.info("[ActiveMatch] cleared_terminal", { reason: "match:update_aborted" });
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
        timerDeadlineRef.current = null;
        setTimer(null);
        setFinalScores(data.scores);
        console.info("[ActiveMatch] cleared_terminal", { reason: "match:update_ended" });
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

      // An opponent lock broadcast looks like "<OtherName> locked pick." and
      // is neither self-lock nor a system message. Replace the raw server
      // copy with phase-appropriate wording.
      const isOpponentLockBroadcast =
        !isSelfLockBroadcast &&
        !revealActive &&
        typeof data.message === "string" &&
        data.message.endsWith(" locked pick.");

      if (!isSelfLockBroadcast && !revealActive) {
        if (isOpponentLockBroadcast) {
          // Do not let "SomeName locked pick." overwrite the timer / status.
          // Instead set the opponent indicator and, if I've already picked,
          // show the shared "both locked" copy immediately.
          setOpponentPicked(true);
          if (hasSubmittedPickRef.current) {
            setStatus("Locked in — revealing soon");
            setOpponentStatus("");
          } else {
            setOpponentStatus("Opponent locked in — choose your lane");
          }
        } else {
          setStatus(data.message);
        }
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
        // Authoritative gameplay-has-begun signal.
        //
        // `match:status` with `timeoutSeconds` is emitted ONLY by
        // `startRoundTimer`. Every pre-start overlay state must be torn
        // down here so overlays never linger past the moment the pick
        // window actually opens, regardless of whether `match:stagingBegin`
        // or `match:update(matchStartedAt)` arrived in the expected order.
        setIsStaging(false);
        setStagingStartsAt(null);
        setWaitingForReturnDeadline(null);
        setAbsentOpponentName(null);
        setReturnSecondsRemaining(null);
        // Kill the tournament staging screen (z-50) immediately — its
        // client-side countdown runs ~1.5 s longer than the server's
        // STAGING_COUNTDOWN_MS (3700 ms) which would block lane clicks.
        setTournamentStagingCountdown(null);
        tournamentStagingDismissedRef.current = true;
        // Pick timer is genuinely open — clear the inter-round pause flag.
        setIsInterRound(false);
        // Reset per-round pick state for the new round.
        setOpponentPicked(false);
        pickInFlightRef.current = false;

        if (disconnectCountdownRef.current !== null) {
          clearDisconnectCountdownVisual();
        }

        // isResume: true means the pick window for the CURRENT round is
        // resuming after a reconnect. Preserve the already-locked pick
        // so Player A is not forced to re-pick after Player B reconnects.
        const isTimerResume = data.isResume === true;

        // Arm the timer deadline immediately so it is accurate the moment
        // picks open (whether that's now or after the reveal hold).
        const clampedSeconds = Math.min(data.timeoutSeconds, 10);
        timerDeadlineRef.current = Date.now() + clampedSeconds * 1000;
        setTimer(clampedSeconds);
        setTimerTick((n) => n + 1);

        // Reveal-pacing guard: when a result is currently mid-reveal, preserve
        // it instead of force-flushing. The timer deadline is already set above
        // so the RAF loop is accurate; picks are visually gated by revealStage
        // until the hold timer transitions back to IDLE. The hold timer then
        // flushes any deferred match:update naturally.
        // Exception: reconnect resumes (isTimerResume) always flush immediately
        // because there is no armed reveal to protect in that path.
        if (isRevealActive() && !isTimerResume) {
          // Fast-forward REVEALING → REVEALED so the result shows immediately
          // rather than waiting out the remaining tension window.
          if (matchResultRevealArmedRef.current && pendingRevealPayloadRef.current) {
            clearMatchResultRevealTimeout();
            matchResultRevealArmedRef.current = false;
            applyRevealedResult(pendingRevealPayloadRef.current);
          }
          if (process.env.NODE_ENV !== "production") {
            console.info(
              "[RevealTiming] timeoutSeconds during reveal — fast-forwarded to REVEALED; picks gated until hold completes"
            );
          }
          return;
        }

        // No active reveal — original PR #108 force-flush so picks open immediately.
        const pendingUpdate = deferredMatchUpdatePayloadRef.current;
        deferredMatchUpdatePayloadRef.current = null;
        clearAllRevealTimers();

        if (pendingUpdate) {
          onMatchUpdate(pendingUpdate);
        } else if (!isTimerResume) {
          setRevealStage("IDLE");
          setHasSubmittedPick(false);
          setMyPick(null);
          setResult(null);
          setPendingResult(null);
          setResultFlavorMessage(null);
          setOpponentStatus("");
        } else {
          // Resume: clear any reveal state but keep existing pick intact
          setRevealStage("IDLE");
          setOpponentStatus("");
        }

        if (process.env.NODE_ENV !== "production") {
          console.info("[timer] timer_authoritative_sync", {
            timeoutSeconds: data.timeoutSeconds,
            clamped: clampedSeconds,
            deadline: timerDeadlineRef.current,
          });
        }
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

      // ── Unity live shadow preview (B5B1) — RESULT phase, default-off ──
      // React has now reached REVEALED. This is the sequencing boundary: only
      // now forward the GOAL/SAVE/DRAW to the optional Unity iframe, built purely
      // from authoritative server-resolved state. NO new timer — React's reveal
      // timing above is the single source of sequencing. Skipped unless BOTH
      // flags are "true" and both lanes are present; scores are frozen; the
      // result comes straight from the server and is never derived from lanes.
      if (
        process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true" &&
        process.env.NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true" &&
        authoritative.kickerPick &&
        authoritative.keeperPick
      ) {
        const resultRound =
          authoritative.round ?? lastPickRoundRef.current ?? 0;
        // Distinct id from the staging message for this round (…:result vs …:staging).
        const resultId = `${normalizedRoomCode}:${liveMatchInstanceRef.current}:${resultRound}:result`;
        setUnityShadowMessage({
          id: resultId,
          message: {
            type: "PENALTY444_MATCH_EVENT",
            event: "round_result",
            payload: {
              kickerLane: authoritative.kickerPick,
              keeperLane: authoritative.keeperPick,
              result: authoritative.result,
              // Latest client-held authoritative score snapshot, frozen at
              // build time (match:result carries no scores → may be pre-result;
              // no local score calc; Unity ignores scores). Copied so later
              // state updates can't mutate it.
              scores: { ...liveScoresRef.current },
              round: resultRound,
              maxRounds: liveMaxRoundsRef.current,
              phase: livePhaseRef.current,
            },
          },
        });
      }

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
        pendingRevealPayloadRef.current = null;
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

        const pendingEnd = deferredMatchEndPayloadRef.current;
        deferredMatchEndPayloadRef.current = null;
        if (pendingEnd) {
          console.info("[RevealTiming] flushing deferred match:end");
          onMatchEnd(pendingEnd);
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
        window.setTimeout(() => { setImpactResult(null); }, 900);
      } else if (authoritative.result === "SAVE") {
        setImpactResult("SAVE");
        window.setTimeout(() => { setImpactResult(null); }, 900);
      } else if (authoritative.result === "DRAW") {
        setImpactResult("DRAW");
        window.setTimeout(() => { setImpactResult(null); }, 700);
      }

      if (authoritative.result === "GOAL") {
        setScreenEffect("GOAL");
        window.setTimeout(() => { setScreenEffect(null); }, 900);
      } else if (authoritative.result === "SAVE") {
        setScreenEffect("SAVE");
        window.setTimeout(() => { setScreenEffect(null); }, 900);
      } else if (authoritative.result === "DRAW") {
        setScreenEffect("DRAW");
        window.setTimeout(() => { setScreenEffect(null); }, 700);
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

      // ── Unity live shadow preview (B5B1) — STAGING phase, default-off ──
      // The result has passed EVERY existing room/round/payload validation and
      // React is about to enter REVEALING. Tell the optional Unity iframe to
      // enter its staging ("Get ready…") pose NOW; the actual GOAL/SAVE/DRAW is
      // sent later, only when React reaches REVEALED (see applyRevealedResult).
      // React's existing reveal timing is unchanged and is the single source of
      // sequencing — no Unity timer or ack controls React. This sets an isolated
      // presentation state only; skipped unless BOTH flags are "true" and both
      // lanes are present. env checks inlined (not reactive) so no new socket-
      // effect dependency is introduced.
      if (
        process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true" &&
        process.env.NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true" &&
        authoritative.kickerPick &&
        authoritative.keeperPick
      ) {
        const stagingRound =
          authoritative.round ?? expectedRound ?? lastPickRoundRef.current ?? 0;
        // Stable id from authoritative identifiers. Date.now() is used ONLY for
        // startsAt, never as the message identity.
        const stagingId = `${normalizedRoomCode}:${liveMatchInstanceRef.current}:${stagingRound}:staging`;
        setUnityShadowMessage({
          id: stagingId,
          message: {
            type: "PENALTY444_MATCH_EVENT",
            event: "staging_begin",
            payload: { startsAt: Date.now() },
          },
        });
      }

      // Hotfix — `match:result` is now the single authority that
      // enters REVEALING. Tear down any in-flight reveal timers
      // first so a racing earlier result can't keep ticking.
      clearAllRevealTimers();
      closingRevealRoundSnapshotRef.current =
        authoritative.round ?? expectedRound ?? lastPickRoundRef.current;

      // Clear per-round pick indicators — reveal narrative takes over.
      setOpponentStatus("");
      setOpponentPicked(false);
      timerDeadlineRef.current = null;
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
      pendingRevealPayloadRef.current = authoritative;
      setRevealStage("REVEALING");
      revealingStartedAtRef.current = Date.now();
      const lockedLabel = "Locked in — revealing soon";
      setStatus(lockedLabel);
      matchResultRevealArmedRef.current = true;

      matchResultRevealTimeoutRef.current = window.setTimeout(() => {
        matchResultRevealTimeoutRef.current = null;
        matchResultRevealArmedRef.current = false;
        applyRevealedResult(authoritative);
      }, revealDelayMs);
    }

    function onMatchInterRound(data: { roomCode?: string; code?: string }) {
      if (!isSocketEventForRoom(data, normalizedRoomCode)) return;
      setIsInterRound(true);
    }

    function onMatchEnd(payload: MatchEndPayload) {
      // If a result reveal is in progress, defer match-end so the GOAL/SAVE/DRAW
      // headline gets its full hold before the match-end screen appears.
      if (isRevealActive()) {
        deferredMatchEndPayloadRef.current = payload;
        // Fast-forward from REVEALING → REVEALED so the result shows immediately
        // rather than waiting out the remaining tension window.
        if (matchResultRevealArmedRef.current && pendingRevealPayloadRef.current) {
          clearMatchResultRevealTimeout();
          matchResultRevealArmedRef.current = false;
          applyRevealedResult(pendingRevealPayloadRef.current);
        }
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
      timerDeadlineRef.current = null;
      setTimer(null);
      console.info("[ActiveMatch] cleared_terminal", { reason: "match:end" });
      clearActiveMatch();
      setRematchVotes(0);
      setRematchRequired(2);
      setLastRematchRequesterId(null);
      setRematchDeclinedBy(null);
      setRematchRequested(false);
      setLeaveMatchBusy(false);

      // ── Unity live shadow preview (B5B2) — MATCH END, default-off ──
      // Runs ONLY in this terminal branch — the reveal-active branch above
      // defers and returns, so the final round result keeps its existing reveal
      // hold first (the deferred onMatchEnd re-runs here after the hold). Classify
      // the final authoritative scores into winnerId/isDraw for Unity's MATCH
      // OVER / MATCH DRAW banner. Presentation only; skipped unless BOTH flags are
      // "true"; a malformed snapshot fails open (no send). Stable id dedupes a
      // duplicate match:end for the same match instance. env checks inlined (not
      // reactive) → no new socket-effect dependency.
      if (
        process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true" &&
        process.env.NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true"
      ) {
        const presentation = getUnityMatchEndPresentation(payload.scores);
        if (presentation) {
          setUnityShadowMessage({
            id: `${normalizedRoomCode}:${liveMatchInstanceRef.current}:match-end`,
            message: {
              type: "PENALTY444_MATCH_EVENT",
              event: "match_end",
              payload: {
                winnerId: presentation.winnerId,
                isDraw: presentation.isDraw,
              },
            },
          });
        } else if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[unity-shadow] match_end skipped — malformed final scores",
            payload.scores
          );
        }
      }

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
      console.info("[ActiveMatch] cleared_terminal", { reason: "match:rematch:declined" });
      clearActiveMatch();
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

      // ── Unity live shadow preview (B5B2) — REMATCH RESET, default-off ──
      // Runs after React's existing rematch reset state is applied. Tells the
      // optional Unity iframe to return to its idle/waiting scene. Presentation
      // only: it does NOT accept the rematch, start the next round, change
      // matchInstance, clear server state, or affect React timing — the following
      // authoritative match:update drives the new rematch state. The id uses the
      // CURRENT (terminal) match instance intentionally: it identifies the match
      // being cleared. Skipped unless BOTH flags are "true"; env checks inlined
      // (not reactive) → no new socket-effect dependency.
      if (
        process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true" &&
        process.env.NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true"
      ) {
        setUnityShadowMessage({
          id: `${normalizedRoomCode}:${liveMatchInstanceRef.current}:rematch-reset`,
          message: {
            type: "PENALTY444_MATCH_EVENT",
            event: "reset",
            payload: null,
          },
        });
      }
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
        console.info("[Reconnect] applied_authoritative_state", {
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
        console.info("[ActiveMatch] cleared_terminal", { reason: "match:rejoinState_ended" });
        clearActiveMatch();
        // Tear down any pre-start overlay, then show the cancelled message
        // so the player gets a clear "Back to Lobby" path instead of a
        // blank or "Waiting for opponent" screen.
        setIsStaging(false);
        setStagingStartsAt(null);
        setWaitingForReturnDeadline(null);
        setAbsentOpponentName(null);
        setReturnSecondsRemaining(null);
        setCancelledMessage("This match has already ended.");
        clearAbortRedirectTimeout();
        abortRedirectTimeoutRef.current = window.setTimeout(() => {
          abortRedirectTimeoutRef.current = null;
          router.push("/lobby");
        }, 2500);
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
          setOpponentPicked(true);
          setStatus("Locked in — revealing soon");
          setOpponentStatus("");
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
          setOpponentPicked(true);
          setStatus("Opponent locked in — choose your lane");
          setOpponentStatus("Opponent locked in — choose your lane");
        } else {
          setOpponentStatus("");
        }
        setRevealStage("IDLE");
      }
    }

    function onErrorMessage(payload: { message: string }) {
      setLeaveMatchBusy(false);
      setStatus(payload.message);

      const isTerminalRoomError =
        payload.message === "This match has already ended." ||
        payload.message === "Room not found";

      if (isTerminalRoomError) {
        const terminalMessage =
          payload.message === "Room not found"
            ? "This match is no longer active."
            : payload.message;
        const logReason =
          payload.message === "Room not found"
            ? "room_not_found"
            : "already_ended";
        console.info("[ActiveMatch] cleared_terminal_room", {
          reason: logReason,
          message: payload.message,
        });
        clearActiveMatch();
        setCancelledMessage(terminalMessage);
        clearAbortRedirectTimeout();
        abortRedirectTimeoutRef.current = window.setTimeout(() => {
          abortRedirectTimeoutRef.current = null;
          router.push("/lobby");
        }, 2500);
      }
    }

    function onMatchAborted(_payload: MatchAbortedPayload) {
      matchAbortedRef.current = true;
      setLeaveMatchBusy(false);
      setMatchAborted(true);
      setMatchAbortedMessage("No penalty applied.");
      setRedirectingAfterAbort(false);

      if (disconnectCountdownRef.current !== null) {
        clearDisconnectCountdownVisual();
      }

      clearAllRevealTimers();
      clearDeferredMatchUpdate();
      console.info("[ActiveMatch] cleared_terminal", { reason: "match:aborted" });
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
      console.info("[ActiveMatch] cleared_terminal", { reason: "match:cancelled" });
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
    socket.on("match:interRound", onMatchInterRound);
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
      effectActive = false;
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
      socket.off("match:interRound", onMatchInterRound);
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

  // Deadline-accurate countdown via requestAnimationFrame.
  // Driven by timerTick (set in onMatchStatus alongside timerDeadlineRef)
  // so React re-renders from setTimer() calls do NOT restart the loop.
  // Integers for ≥ 4 s, one decimal for < 4 s ("3.9 → 0.1") so the final
  // seconds feel alive rather than mechanically snapping between integers.
  useEffect(() => {
    if (timerDeadlineRef.current === null) return;

    let rafId: ReturnType<typeof requestAnimationFrame>;
    let active = true;

    function tick() {
      if (!active || timerDeadlineRef.current === null) return;
      const ms = timerDeadlineRef.current - Date.now();
      const clamped = Math.max(0, ms);
      setTimer(Math.min(Math.ceil(clamped / 1000), 10));
      if (clamped > 0) rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [timerTick]);

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
  // Final second — button disabling + "Time almost up" label prevents
  // clicks the server is about to reject anyway.
  const isTimerAlmostDone =
    timer !== null && timer > 0 && timer <= 1 && !hasSubmittedPick;
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
    !isInterRound &&
    !isPreStartGate &&
    !!identity &&
    // Prevent clicks in the final second — visually honest, prevents
    // sending picks the server deadline is about to reject.
    !isTimerAlmostDone;

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
    // Double-tap guard: a second pointer event can arrive before React
    // re-renders to flip `hasSubmittedPick`. The ref is reset synchronously
    // when `hasSubmittedPick` goes back to false (round advance / match end).
    if (pickInFlightRef.current) return;
    pickInFlightRef.current = true;

    if (process.env.NODE_ENV !== "production") {
      console.info("[match:pick] pick_clicked", { lane, round, phase });
    }

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

    // Phase-aware copy: never show "Waiting for opponent" when both locked.
    if (isDisconnectGraceStillActive()) {
      // Opponent disconnected — abort grace is the authoritative signal.
      setOpponentStatus("");
      setStatus(`You locked ${lane}. Opponent disconnected.`);
    } else if (opponentPicked) {
      // Opponent already locked before us — both are now locked.
      setStatus("Locked in — revealing soon");
      setOpponentStatus("");
    } else {
      setStatus("Pick locked in — waiting for opponent");
      setOpponentStatus("Opponent is thinking...");
    }

    if (process.env.NODE_ENV !== "production") {
      console.info("[match:pick] pick_locally_locked", {
        lane,
        round,
        opponentAlreadyPicked: opponentPicked,
      });
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
    if (elapsed < 400) return null;   // brief locked-in pause
    if (elapsed < 1200) return 3;     // show "3" for ~800ms
    if (elapsed < 2000) return 2;     // show "2" for ~800ms
    if (elapsed < 2700) return 1;     // show "1" for ~700ms
    return null;                       // last ~300ms: brief gap before REVEALED
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
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 px-5 py-5 text-center shadow-2xl sm:rounded-3xl sm:px-6 sm:py-7">
            {cancelledMessage !== null ? (
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-red-300/90 sm:text-xs">
                  Match cancelled
                </p>
                <p className="mt-2 text-sm text-zinc-100 sm:mt-3 sm:text-base">
                  {cancelledMessage}
                </p>
                <p className="mt-2 text-xs text-zinc-400">
                  Returning to lobby...
                </p>
              </>
            ) : isStaging ? (
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-emerald-300/90 sm:text-xs">
                  Both players ready
                </p>
                <p className="mt-3 text-2xl font-black tracking-tight text-white sm:mt-4 sm:text-3xl">
                  Match starting...
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-[0.28em] text-zinc-500 sm:mt-3">
                  Get ready
                </p>
              </>
            ) : waitingForReturnDeadline !== null ? (
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-amber-300/90 sm:text-xs">
                  Waiting for opponent
                </p>
                <p className="mt-2 text-xs text-zinc-300 sm:mt-3 sm:text-sm">
                  {isTournamentMatch
                    ? absentOpponentName
                      ? `${absentOpponentName} hasn't entered yet. Waiting for them to join.`
                      : "Waiting for your opponent to enter the match."
                    : absentOpponentName
                      ? `${absentOpponentName} stepped away. Holding until they return.`
                      : "Holding the match until your opponent returns."}
                </p>
                <p className="mt-3 text-4xl font-black tabular-nums text-white sm:mt-4 sm:text-5xl">
                  {returnSecondsRemaining ?? "—"}s
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-[0.28em] text-zinc-500 sm:mt-3">
                  No penalty if cancelled
                </p>
              </>
            ) : isTournamentMatch ? (
              <TournamentWaitingForOpponentCard />
            ) : (
              <WaitingForOpponentCard roomCode={normalizedRoomCode} />
            )}
          </div>
        </div>
      ) : null}
      <div
        className={`relative z-10 main-container flex flex-col gap-0.5 px-1 py-1 text-white h-svh max-h-svh ${matchEnded ? "overflow-y-auto" : "overflow-hidden"} sm:px-4 sm:py-3 md:px-6 md:py-4 sm:gap-2 ${
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
        className={`match-container shrink-0 overflow-hidden rounded-xl sm:rounded-[2rem] border bg-gradient-to-br shadow-2xl transition-all duration-300 ease-out ${
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
        <div className="border-b border-zinc-800 px-1.5 py-1 sm:px-3 sm:py-2 md:px-6 md:py-4">
          <div className="flex flex-row items-start gap-2 justify-between md:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                <span
                  className={`rounded-full px-1.5 py-0.5 font-black uppercase tracking-[0.2em] sm:px-3 sm:py-1 ${
                    isSuddenDeath
                      ? "bg-amber-400 px-3 py-1 text-xs text-black shadow-[0_0_18px_rgba(251,191,36,0.45)] sm:px-4 sm:py-1.5 sm:text-sm"
                      : "bg-emerald-400 text-[9px] text-black sm:text-xs"
                  }`}
                >
                  {phaseLabel}
                </span>

                <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300 sm:px-3 sm:py-1 sm:text-xs">
                  Room {roomCode}
                </span>

                {isTournamentMatch ? (
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest sm:px-3 sm:py-1 sm:text-[10px] ${
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
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold sm:px-3 sm:py-1 sm:text-xs ${
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
              <h1 className="min-w-0 truncate text-xs font-black leading-tight sm:text-lg md:mt-2 md:text-2xl lg:text-3xl">
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
                className={`max-w-2xl text-[10px] sm:mt-2 sm:text-sm ${
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
                <div className="mt-2 max-w-2xl rounded-xl border border-red-500/40 bg-red-950/35 px-3 py-1.5 sm:py-2">
                  <p className="text-xs font-semibold text-red-200 sm:text-sm">
                    Opponent disconnected. Aborting match in{" "}
                    {disconnectCountdown}s...
                  </p>
                </div>
              ) : null}

              {showLeaveMatchControls ? (
                <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-2 sm:mt-3 sm:gap-3">
                  {isEarlyCancelWindow ? (
                    <button
                      type="button"
                      onClick={abortEarlyMatch}
                      disabled={leaveMatchBusy}
                      className="rounded-xl border border-zinc-500 bg-zinc-900 px-3 py-1.5 text-xs font-bold text-zinc-100 hover:border-zinc-300 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
                    >
                      {leaveMatchBusy ? "Cancelling..." : "Cancel Match"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={forfeitMatch}
                      disabled={leaveMatchBusy}
                      className="rounded-xl border border-red-500/50 bg-red-950/40 px-3 py-1.5 text-xs font-bold text-red-100 hover:border-red-400/70 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
                    >
                      {leaveMatchBusy ? "Leaving..." : "Forfeit"}
                    </button>
                  )}
                  {isEarlyCancelWindow ? (
                    <span className="text-[11px] text-zinc-400 sm:text-xs">
                      No penalty for {earlyCancelSecondsLeft}s
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-500 sm:text-xs">
                      Counts as a loss
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            <div
              className={`flex shrink-0 flex-col items-center justify-center gap-0 self-stretch rounded-lg border px-3 py-1 text-center shadow-lg transition-all duration-300 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:rounded-xl sm:px-4 sm:py-2 sm:text-center md:block md:w-auto md:min-w-[9.5rem] md:self-auto md:rounded-3xl md:px-6 md:py-5 ${
                isInterRound
                  ? "border-zinc-600 bg-zinc-900/70"
                  : isTimerAlmostDone
                    ? "match-timer-almost-done border-red-500/95 bg-red-600/25"
                    : isTimerUrgent
                      ? "match-timer-urgent border-red-400/90 bg-red-500/20"
                      : isSuddenDeath
                        ? "match-timer-sudden-death border-yellow-400/80 bg-yellow-500/15"
                        : "border-zinc-700 bg-zinc-900"
              }`}
            >
              <p
                className={`text-[8px] font-black uppercase tracking-[0.22em] sm:text-xs ${
                  isInterRound
                    ? "text-zinc-500"
                    : isTimerAlmostDone || isTimerUrgent
                      ? "text-red-200"
                      : isSuddenDeath
                        ? "text-yellow-200/90"
                        : "text-zinc-400"
                }`}
              >
                {isInterRound
                  ? "Get ready"
                  : isTimerAlmostDone
                    ? "Time almost up…"
                    : isTimerUrgent
                      ? "Lock in!"
                      : hasSubmittedPick
                        ? "Waiting"
                        : "Pick timer"}
              </p>
              <p
                className={`text-base font-black tabular-nums transition-transform duration-300 sm:text-5xl sm:mt-1 md:text-6xl ${
                  isInterRound
                    ? "text-zinc-600"
                    : isTimerAlmostDone || isTimerUrgent
                      ? "text-red-200"
                      : isSuddenDeath
                        ? "text-yellow-100"
                        : "text-white"
                }`}
              >
                {isInterRound
                  ? "—"
                  : (hasSubmittedPick && opponentPicked) || isRevealLocked
                    ? "—"
                    : timer !== null
                      ? timer
                      : "—"}
              </p>
              <p
                className={`hidden text-[11px] font-bold uppercase tracking-wider sm:block ${
                  isInterRound
                    ? "text-zinc-600"
                    : isTimerAlmostDone || isTimerUrgent
                      ? "text-red-200/85"
                      : isSuddenDeath
                        ? "text-yellow-200/70"
                        : "text-zinc-500"
                }`}
              >
                {isInterRound
                  ? "next round"
                  : isTimerAlmostDone
                    ? "last chance"
                    : isTimerUrgent
                      ? "Hurry"
                      : "seconds"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 sm:gap-2 sm:p-2 md:gap-4 md:p-5">
          <div className="flex min-w-0 items-center justify-between gap-1 rounded-lg border border-zinc-800 bg-black/40 px-1.5 py-0.5 sm:block sm:rounded-xl sm:p-2 md:rounded-3xl md:p-4">
            <p className="truncate text-[8px] font-bold uppercase tracking-[0.1em] text-zinc-500 sm:text-[10px] sm:tracking-[0.18em] md:text-xs">
              Role
            </p>
            <p className="truncate text-[11px] font-black leading-none sm:mt-1 sm:text-base md:mt-2 md:text-xl">
              {myRole || "—"}
            </p>
          </div>

          <div
            className={`flex min-w-0 items-center justify-between gap-1 rounded-lg border bg-black/40 px-1.5 py-0.5 sm:block sm:rounded-xl sm:p-2 md:rounded-3xl md:p-4 ${
              isSuddenDeath
                ? "border-amber-400/45 shadow-[inset_0_0_24px_rgba(251,191,36,0.06)]"
                : isLateGame
                  ? "border-red-400/30"
                  : "border-zinc-800"
            }`}
          >
            <p
              className={`truncate text-[8px] font-bold uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-[0.18em] md:text-xs ${
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
              className={`truncate font-black leading-none sm:mt-1 md:mt-2 ${
                isSuddenDeath
                  ? "text-[11px] text-amber-200 sm:text-lg md:text-2xl"
                  : isLateGame
                    ? "text-[11px] text-zinc-100 sm:text-base md:text-xl"
                    : "text-[11px] sm:text-base md:text-xl"
              }`}
            >
              {roundLabel}
            </p>
          </div>
        </div>
      </section>

      {isSuddenDeath && !matchEnded ? (
        <section className="shrink-0 rounded-xl border border-yellow-400/70 bg-gradient-to-r from-yellow-950/60 via-amber-950/40 to-black px-2 py-1.5 shadow-xl shadow-yellow-500/10 sm:rounded-2xl sm:px-3 sm:py-2 md:rounded-[2rem] md:p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-yellow-300/90 sm:text-xs">
            ⚡ Sudden Death
          </p>
          <h2 className="mt-0.5 text-sm font-black text-yellow-50 sm:mt-1 sm:text-xl md:text-2xl">
            One clean cycle decides everything.
          </h2>
          <p className="mt-0.5 text-xs text-yellow-100/80 sm:mt-1 sm:text-sm md:text-base">
            Both players were tied after normal rounds. Score while your
            opponent fails and the match ends.
          </p>
        </section>
      ) : null}

      <div className="shrink-0">
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
          currentTurn={round}
          totalTurns={normalTurns}
        />
      </div>

      {matchEnded && matchEndOutcome ? (
        <section
          className={`shrink-0 rounded-2xl border p-3 shadow-2xl sm:rounded-2xl sm:p-3.5 md:rounded-[2rem] md:p-7 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))] ${
            matchEndOutcome === "victory"
              ? "border-emerald-400/70 bg-gradient-to-br from-emerald-950/55 via-zinc-950 to-amber-950/35 ring-2 ring-emerald-400/25 shadow-[0_0_48px_rgba(16,185,129,0.22)]"
              : matchEndOutcome === "defeat"
                ? "border-red-500/55 bg-gradient-to-br from-red-950/45 via-zinc-950 to-zinc-950 ring-2 ring-red-500/20 shadow-[0_0_40px_rgba(239,68,68,0.15)]"
                : "border-yellow-400/55 bg-gradient-to-br from-yellow-950/30 via-zinc-950 to-zinc-900 ring-2 ring-yellow-400/20 shadow-[0_0_36px_rgba(234,179,8,0.14)]"
          }`}
        >
          <p
            className={`text-[10px] font-black uppercase tracking-[0.3em] sm:text-xs ${
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
              className={`mt-2 text-[10px] font-black uppercase tracking-[0.28em] sm:mt-4 sm:text-[11px] ${
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
            className={`mt-1 truncate text-xl font-black uppercase tracking-tight sm:mt-1.5 sm:text-2xl md:mt-2 md:text-4xl ${
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
            className={`mt-1 max-w-xl text-xs font-semibold leading-snug sm:mt-2 sm:text-sm md:text-lg ${
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
            className={`mt-2 overflow-hidden rounded-xl border px-2 py-2 sm:mt-3 sm:rounded-xl sm:px-4 sm:py-3 md:px-6 md:py-5 ${
              matchEndOutcome === "victory"
                ? "border-emerald-400/35 bg-black/40 shadow-[inset_0_1px_0_rgba(52,211,153,0.1)]"
                : matchEndOutcome === "defeat"
                  ? "border-red-500/30 bg-black/45 shadow-[inset_0_1px_0_rgba(239,68,68,0.08)]"
                  : "border-yellow-400/30 bg-black/40 shadow-[inset_0_1px_0_rgba(234,179,8,0.08)]"
            }`}
          >
            <p className="text-center text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 sm:text-xs">
              Final Score
            </p>
            <div className="mt-2 flex items-center justify-center gap-3 text-center sm:mt-3 sm:gap-4 md:mt-4 md:gap-8">
              <div className="flex min-w-[4.5rem] flex-col items-center sm:min-w-[5.5rem] md:min-w-[7rem]">
                <p className="truncate text-[9px] font-black uppercase tracking-widest text-zinc-500 sm:text-[10px]">
                  {myName}
                </p>
                <p className={`mt-1 text-4xl font-black tabular-nums leading-none sm:text-5xl md:text-7xl ${matchEndOutcome === "victory" ? "text-white drop-shadow-[0_0_16px_rgba(52,211,153,0.4)]" : "text-white/80"}`}>
                  {myScore}
                </p>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-xs font-black text-zinc-700 sm:text-base md:text-xl">—</span>
              </div>
              <div className="flex min-w-[4.5rem] flex-col items-center sm:min-w-[5.5rem] md:min-w-[7rem]">
                <p className="truncate text-[9px] font-black uppercase tracking-widest text-zinc-500 sm:text-[10px]">
                  {opponentName}
                </p>
                <p className={`mt-1 text-4xl font-black tabular-nums leading-none sm:text-5xl md:text-7xl ${matchEndOutcome === "defeat" ? "text-white drop-shadow-[0_0_16px_rgba(239,68,68,0.3)]" : "text-white/80"}`}>
                  {opponentScore}
                </p>
              </div>
            </div>
          </div>

          {!isTournamentMatch ? (
            <p className="mt-3 text-xs text-zinc-400 sm:mt-6 sm:text-sm">
              Rematch votes: {rematchVotes}/{rematchRequired}
            </p>
          ) : null}

          {!isTournamentMatch && rematchDeclinedBy && rematchDeclinedBy !== myPlayerId ? (
            <p className="mt-2 text-xs font-semibold text-zinc-200 sm:mt-3 sm:text-sm">
              Opponent declined rematch.
            </p>
          ) : null}
          {!isTournamentMatch && rematchDeclinedBy && rematchDeclinedBy === myPlayerId ? (
            <p className="mt-2 text-xs font-semibold text-zinc-200 sm:mt-3 sm:text-sm">
              You declined rematch.
            </p>
          ) : null}

          {!isTournamentMatch &&
          rematchRequested &&
          rematchVotes < rematchRequired &&
          !rematchDeclinedBy ? (
            <p className="mt-2 text-xs font-semibold text-zinc-300 sm:mt-3 sm:text-sm">
              Waiting for opponent...
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:mt-6 sm:gap-3 md:flex-row md:flex-wrap md:items-center">
            {!isTournamentMatch && showOpponentRematchPrompt ? (
              <div className="flex w-full flex-col gap-2 sm:gap-3 md:max-w-md">
                <p className="text-center text-xs font-semibold text-zinc-100 sm:text-sm md:text-left">
                  Opponent requested a rematch
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                  <button
                    type="button"
                    onClick={requestRematch}
                    disabled={!identity}
                    className="rounded-xl bg-white px-4 py-3 text-sm font-black text-black disabled:opacity-50 sm:rounded-2xl sm:px-5 sm:py-4 sm:text-base"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={declineRematch}
                    disabled={!identity}
                    className="rounded-xl border border-white/35 px-4 py-3 text-sm font-black text-white hover:bg-white/10 disabled:opacity-50 sm:rounded-2xl sm:px-5 sm:py-4 sm:text-base"
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
                className="rounded-xl bg-white px-4 py-3 text-sm font-black text-black disabled:opacity-50 sm:rounded-2xl sm:px-5 sm:py-4 sm:text-base"
              >
                {rematchRequested ? "Rematch Requested" : "Rematch"}
              </button>
            ) : null}

            {opponentName.trim().length > 0 && opponentName !== "Opponent" ? (
              <Link
                href={`/profile/${encodeURIComponent(opponentName)}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-black/40 px-4 py-3 text-center text-xs font-black uppercase tracking-wider text-zinc-200 transition-colors hover:border-cyan-400/55 hover:text-cyan-100 sm:rounded-2xl sm:px-5 sm:py-4 sm:text-sm"
              >
                <span aria-hidden>👤</span>
                View Opponent
              </Link>
            ) : null}

            {!isTournamentMatch &&
            opponentName.trim().length > 0 &&
            opponentName !== "Opponent" ? (
              <Link
                href={`/lobby?challenge=${encodeURIComponent(opponentName)}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/45 bg-cyan-500/10 px-4 py-3 text-center text-xs font-black uppercase tracking-wider text-cyan-100 transition-colors hover:bg-cyan-500/20 sm:rounded-2xl sm:px-5 sm:py-4 sm:text-sm"
              >
                <span aria-hidden>⚔</span>
                Challenge Again
              </Link>
            ) : null}

            {isTournamentMatch && tournamentId ? (
              <div
                className={`flex w-full flex-col gap-2 rounded-xl border px-4 py-3 sm:gap-3 sm:rounded-2xl sm:px-5 sm:py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between ${
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
                    className={`text-[10px] font-black uppercase tracking-[0.25em] sm:text-xs ${
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
                    <p className="inline-flex items-baseline gap-2 text-xs font-semibold text-zinc-200 sm:text-sm">
                      {isFinalTournamentMatch && matchEndOutcome === "victory"
                        ? "Champion moment on tournament page in"
                        : matchEndOutcome === "victory"
                          ? "Returning to tournament in"
                          : matchEndOutcome === "defeat"
                            ? "Returning to tournament in"
                            : "Returning to tournament in"}
                      <span className="text-xl font-black tabular-nums text-white sm:text-2xl">
                        {tournamentRedirectCountdown}s
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs font-semibold text-zinc-200 sm:text-sm">
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
                  className={`rounded-xl px-4 py-2.5 text-sm font-black shadow-lg sm:rounded-2xl sm:px-5 sm:py-3 sm:text-base ${
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
                className="rounded-xl border border-white/30 px-4 py-3 text-center text-sm font-black text-white hover:bg-white hover:text-black sm:rounded-2xl sm:px-5 sm:py-4 sm:text-base"
              >
                Back to Lobby
              </a>
            )}
          </div>

          {/* Post-match beta-feedback shortcut → existing Account feedback
              anchor. Secondary to the actions above: a subtle neutral pill,
              not an accented primary CTA. */}
          <div className="mt-4 flex flex-col items-center gap-1 text-center">
            <p className="text-[11px] text-zinc-400">Something went wrong?</p>
            <Link
              href="/account#beta-feedback"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-600 bg-white/[0.06] px-3.5 py-1.5 text-xs font-bold text-zinc-100 transition-colors hover:border-zinc-400 hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
            >
              Report issue from this match →
            </Link>
          </div>
        </section>
      ) : null}

      {!matchEnded ? (
        <section className={`relative shrink-0 overflow-hidden rounded-lg border shadow-xl shadow-black/50 transition-colors duration-300 sm:rounded-2xl sm:p-3 md:rounded-[2rem] md:p-5 ${canPick && !isRevealLocked ? "border-zinc-700/60 bg-[#070d0f]" : "border-zinc-800 bg-zinc-900/95"} px-1 py-0.5`}>
          {/* Subtle pitch-lane dividers */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 opacity-[0.03]" style={{backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.8) 0, rgba(255,255,255,0.8) 1px, transparent 1px, transparent 33.33%)"}} />
          {revealStage === "LOCKED" && !isRevealLocked ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/50 backdrop-blur-[2px] sm:rounded-[2rem]"
              aria-live="polite"
            >
              <div className="p444-pick-locked-pulse rounded-2xl border border-cyan-400/50 bg-cyan-950/40 px-4 py-3 text-center shadow-[0_0_32px_rgba(56,189,248,0.25)] sm:px-6 sm:py-4">
                <p className="text-[10px] font-black uppercase tracking-[0.34em] text-cyan-300">
                  Pick locked
                </p>
                <p className="mt-1 text-base font-black text-white sm:text-lg">
                  {disconnectCountdown !== null
                    ? "Opponent disconnected"
                    : "Waiting for opponent…"}
                </p>
              </div>
            </div>
          ) : null}

          {/* Mobile-only compact pick status bar */}
          <div className="mb-1 flex items-center justify-between sm:hidden">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
              {revealStage === "LOCKED" || hasSubmittedPick || myPick
                ? "Pick locked in"
                : myRole === "KICKER"
                  ? "Choose your shot"
                  : myRole === "KEEPER"
                    ? "Choose your save"
                    : "Choose your lane"}
            </p>
            {myRole && !isRevealLocked ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.1em] ${
                  myRole === "KICKER"
                    ? "border-amber-400/60 bg-amber-500/10 text-amber-100"
                    : "border-sky-400/60 bg-sky-500/10 text-sky-100"
                }`}
              >
                {myRole}
              </span>
            ) : null}
          </div>

          {/* Header shown sm+ — more detail, role badge, waiting dots */}
          <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-3">
            <h2 className="text-base font-black sm:text-lg md:text-2xl">
              {revealStage === "LOCKED"
                ? "Pick locked"
                : hasSubmittedPick || myPick
                  ? "Pick locked in"
                  : myRole === "KICKER"
                    ? "Choose your shot"
                    : myRole === "KEEPER"
                      ? "Choose your save"
                      : "Choose your lane"}
            </h2>
            <div className="flex items-center gap-2">
              {(hasSubmittedPick || myPick) &&
              !isRevealLocked &&
              disconnectCountdown === null ? (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-200">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden />
                  <span className="match-waiting-dots" aria-hidden>
                    <span className="match-waiting-dot" />
                    <span className="match-waiting-dot" />
                    <span className="match-waiting-dot" />
                  </span>
                </span>
              ) : null}
              {myRole ? (
                <span
                  className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] ${
                    myRole === "KICKER"
                      ? "border-amber-400/60 bg-amber-500/10 text-amber-100"
                      : "border-sky-400/60 bg-sky-500/10 text-sky-100"
                  }`}
                >
                  {myRole}
                </span>
              ) : null}
              {opponentStatus && !isRevealLocked ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200">
                  <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-amber-300" aria-hidden />
                  Opp locked
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-0 grid grid-cols-3 gap-2 sm:mt-3 sm:gap-3 md:mt-5 md:gap-4">
            {LANES.map((lane) => (
              <button
                key={lane}
                onClick={() => pick(lane)}
                disabled={!canPick}
                aria-pressed={myPick === lane}
                className={`group relative flex flex-col items-center justify-center h-20 gap-1 rounded-xl border px-2 sm:h-24 sm:gap-1.5 sm:rounded-2xl sm:px-3 md:h-28 md:gap-2 md:px-4 ${getLaneButtonClass(
                  lane,
                  {
                    canPick,
                    myPick,
                    isSuddenDeath,
                    revealStage,
                  }
                )}`}
              >
                <span className="text-2xl leading-none sm:text-3xl md:text-4xl">
                  {laneEmoji(lane)}
                </span>
                <span className="text-[10px] font-black uppercase leading-none tracking-widest sm:mt-0.5 sm:text-xs md:mt-0.5 md:text-sm">
                  {lane}{myPick === lane ? " ✓" : ""}
                </span>
                {myPick === lane ? (
                  <span className="text-[8px] font-black uppercase tracking-widest text-emerald-300 sm:text-[9px]">
                    Locked
                  </span>
                ) : isRevealLocked ? (
                  <span className="hidden text-[8px] font-bold uppercase tracking-widest text-zinc-500 sm:block sm:text-[9px]">
                    Revealing
                  </span>
                ) : canPick ? (
                  <span className="hidden text-[8px] font-semibold uppercase tracking-widest text-zinc-600 sm:block sm:text-[9px]">
                    {myRole === "KICKER" ? "Shoot" : myRole === "KEEPER" ? "Dive" : "Pick"}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!matchEnded ? (
      <section
        className={`shrink-0 rounded-lg border p-1.5 shadow-2xl transition-all duration-300 sm:rounded-2xl sm:p-3 md:rounded-[2rem] md:p-5 ${resultStyle(
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
        <div className="flex flex-col gap-1 sm:gap-3 md:flex-row md:items-center md:justify-between">
          <div className="md:max-w-xl">
            <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/60 sm:text-xs">
              {shownResult?.round
                ? `Round ${shownResult.round} · Result`
                : "Current result"}
            </p>

            <h2
              className={`inline-flex items-center gap-1 text-sm font-black transition-all duration-300 sm:mt-2 sm:gap-2 sm:text-3xl md:text-5xl ${resultHeadlineClass(
                shownResult?.result,
                revealStage
              )}`}
            >
              {revealStage === "REVEALING" ? (
                tensionCountdown !== null ? (
                  <span
                    key={tensionCountdown}
                    className="p444-tension-digit tabular-nums text-white drop-shadow-[0_0_28px_rgba(56,189,248,0.45)]"
                  >
                    {tensionCountdown}
                  </span>
                ) : (
                  <span className="text-xs uppercase tracking-[0.22em] text-cyan-200/90 sm:text-2xl md:text-3xl">
                    Pick locked
                  </span>
                )
              ) : (
                <>
                  {shownResult?.result ? (
                    <span aria-hidden className="text-sm sm:text-2xl md:text-4xl">
                      {resultEmoji(shownResult.result)}
                    </span>
                  ) : null}
                  <span>{resultLabel(shownResult?.result)}</span>
                </>
              )}
            </h2>

            {revealStage !== "REVEALING" && shownResult?.result ? (
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/80 sm:mt-2 sm:text-sm md:text-base">
                {resultSubheadline(shownResult.result)}
              </p>
            ) : null}

            {revealStage !== "REVEALING" && resultFlavorMessage ? (
              <p className="hidden text-[10px] font-medium italic text-white/65 sm:mt-2 sm:block sm:text-sm">
                {resultFlavorMessage}
              </p>
            ) : null}

            {shownResult?.statusMessage ? (
              <p className="text-[9px] text-white/80 sm:mt-3 sm:text-sm">
                {shownResult.statusMessage}
              </p>
            ) : null}

            {revealStage === "REVEALED" && !matchEnded && shownResult?.result ? (
              <p className="mt-1 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/30 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.22em] text-white/85 sm:mt-4 sm:px-3 sm:py-1.5 sm:text-[11px]">
                <span className="match-waiting-dots" aria-hidden>
                  <span className="match-waiting-dot" />
                  <span className="match-waiting-dot" />
                  <span className="match-waiting-dot" />
                </span>
                Next round · Roles switching
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-1 text-xs sm:gap-2 sm:text-xs md:gap-3">
            <div
              className={`min-w-0 rounded-md border bg-black/30 px-1.5 py-1.5 transition-all duration-300 sm:rounded-xl sm:p-3 ${
                shownResult?.result === "GOAL"
                  ? "border-emerald-300/50 shadow-[0_0_28px_rgba(52,211,153,0.22)]"
                  : shownResult?.result === "SAVE"
                    ? "border-sky-300/40 shadow-[0_0_28px_rgba(56,189,248,0.18)]"
                    : shownResult?.result === "DRAW"
                      ? "border-yellow-300/40 shadow-[0_0_24px_rgba(250,204,21,0.16)]"
                      : "border-white/10"
              } ${revealStage === "REVEALED" ? "scale-[1.05]" : ""}`}
            >
              <p className="truncate text-[8px] font-bold uppercase tracking-[0.18em] text-white/50 sm:text-[10px]">
                {kickerResultLabel}
                <span className="ml-1 text-white/30">· Kicker</span>
              </p>
              <p className="mt-0.5 truncate text-sm font-black leading-tight sm:mt-1.5 sm:text-2xl md:text-3xl">
                {shownResult?.kickerPick
                  ? `${laneEmoji(shownResult.kickerPick)} ${shownResult.kickerPick}`
                  : "—"}
              </p>
            </div>

            <div
              className={`min-w-0 rounded-md border bg-black/30 px-1.5 py-1.5 transition-all duration-300 sm:rounded-xl sm:p-3 ${
                shownResult?.result === "GOAL"
                  ? "border-emerald-300/50 shadow-[0_0_28px_rgba(52,211,153,0.22)]"
                  : shownResult?.result === "SAVE"
                    ? "border-sky-300/40 shadow-[0_0_28px_rgba(56,189,248,0.18)]"
                    : shownResult?.result === "DRAW"
                      ? "border-yellow-300/40 shadow-[0_0_24px_rgba(250,204,21,0.16)]"
                      : "border-white/10"
              } ${revealStage === "REVEALED" ? "scale-[1.05]" : ""}`}
            >
              <p className="truncate text-[8px] font-bold uppercase tracking-[0.18em] text-white/50 sm:text-[10px]">
                {keeperResultLabel}
                <span className="ml-1 text-white/30">· Keeper</span>
              </p>
              <p className="mt-0.5 truncate text-sm font-black leading-tight sm:mt-1.5 sm:text-2xl md:text-3xl">
                {shownResult?.keeperPick
                  ? `${laneEmoji(shownResult.keeperPick)} ${shownResult.keeperPick}`
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {!matchEnded ? (
        <div className="hidden sm:flex sm:shrink-0 sm:items-center sm:justify-center sm:gap-3 sm:rounded-xl sm:border sm:border-zinc-800/40 sm:bg-zinc-950/50 sm:px-4 sm:py-2">
          <span className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-700">Free Play Beta</span>
          <span className="text-zinc-800" aria-hidden>·</span>
          <span className="text-[9px] text-zinc-600">Free Play only · More features coming later</span>
        </div>
      ) : null}

      {/* ── Unity live shadow preview (Phase B5A) — dev-only, default-off ──
          Mounts only when BOTH Unity flags are "true". Secondary panel below
          the arena; it never obscures or replaces lane controls, scoreboard,
          timer, reveal, disconnect, or match-end UI. Presentation only. */}
      {unityShadowEnabled ? (
        <section
          className="mt-6 rounded-2xl border border-dashed border-arena-border bg-arena-surface/60 p-3"
          aria-label="Unity live shadow preview (experimental, presentation only)"
        >
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] text-amber-300">
              Experimental
            </span>
            <span className="rounded bg-zinc-800/70 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-400">
              Shadow preview
            </span>
            <span className="text-[10px] font-semibold text-zinc-500">
              React UI remains authoritative · Server-resolved results only · No
              pick input · No gameplay authority
            </span>
          </div>
          <div className="aspect-video w-full overflow-hidden rounded-xl">
            <MatchRenderer3D
              message={unityShadowMessage?.message ?? null}
              messageId={unityShadowMessage?.id ?? null}
              onError={(m) =>
                console.warn("[unity-shadow] non-blocking Unity error:", m)
              }
            />
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-600">
            React-timed cinematic shadow preview — presentation only. Stages during
            the React reveal, then mirrors the already-resolved result; it never
            drives the match.
          </p>
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
          <div className="w-full max-w-md rounded-2xl border border-zinc-600 bg-zinc-950 px-5 py-6 text-center shadow-2xl sm:px-8 sm:py-10">
            <h2
              id="match-aborted-title"
              className="text-xl font-black tracking-tight text-white sm:text-2xl"
            >
              Match Cancelled
            </h2>
            <p
              id="match-aborted-desc"
              className="mt-2 text-xs leading-relaxed text-zinc-300 sm:mt-3 sm:text-sm"
            >
              {matchAbortedMessage ??
                "No penalty applied."}
            </p>
            {redirectingAfterAbort ? (
              <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 sm:mt-4">
                Returning to lobby...
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}