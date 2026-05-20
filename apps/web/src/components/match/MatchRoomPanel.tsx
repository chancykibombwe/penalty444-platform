"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Lane = "LEFT" | "CENTER" | "RIGHT";
type Role = "KICKER" | "KEEPER";
type ShotResult = "GOAL" | "SAVE" | "DRAW";
type MatchPhase = "NORMAL" | "SUDDEN_DEATH";
type RevealStage = "IDLE" | "LOCKED" | "REVEALING" | "REVEALED";

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
};

type MatchEndPayload = {
  scores: Record<string, number>;
  tournamentId?: string;
};

const MATCH_RESULT_REVEAL_MS = 900;
const TOURNAMENT_MATCH_RESULT_REVEAL_MS = 350;
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
};

const LANES: Lane[] = ["LEFT", "CENTER", "RIGHT"];

const GOAL_MESSAGES = [
  "Clinical finish.",
  "Keeper went the wrong way.",
  "Buried with confidence.",
  "No chance for the keeper.",
] as const;

const SAVE_MESSAGES = [
  "Keeper read it.",
  "Big stop.",
  "Denied.",
  "Perfect guess.",
] as const;

const DRAW_MESSAGES = [
  "No advantage.",
  "Both froze.",
  "Reset and go again.",
  "Nothing separates them.",
] as const;

function pickResultFlavorMessage(result: ShotResult): string {
  const pool =
    result === "GOAL"
      ? GOAL_MESSAGES
      : result === "SAVE"
        ? SAVE_MESSAGES
        : DRAW_MESSAGES;

  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

function laneEmoji(lane: Lane) {
  if (lane === "LEFT") return "↙";
  if (lane === "CENTER") return "⬆";
  return "↘";
}

function resultStyle(result?: ShotResult) {
  if (result === "GOAL") {
    return "border-emerald-400/80 bg-emerald-500/15 text-emerald-100 shadow-[0_0_36px_rgba(52,211,153,0.22)]";
  }

  if (result === "SAVE") {
    return "border-sky-400/80 bg-sky-500/15 text-sky-100 shadow-[0_0_36px_rgba(56,189,248,0.22)]";
  }

  if (result === "DRAW") {
    return "border-yellow-400/80 bg-yellow-500/15 text-yellow-100 shadow-[0_0_32px_rgba(250,204,21,0.18)]";
  }

  return "border-zinc-800 bg-zinc-900 text-white";
}

function resultHeadlineClass(result?: ShotResult, revealStage?: RevealStage) {
  if (revealStage === "REVEALING") {
    return "match-result-reveal-active text-white";
  }

  if (result === "GOAL") {
    return "match-result-headline-goal text-emerald-100";
  }

  if (result === "SAVE") {
    return "match-result-headline-save text-sky-100";
  }

  if (result === "DRAW") {
    return "match-result-headline-draw text-yellow-100";
  }

  return "text-white";
}

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

function resultLabel(result?: ShotResult) {
  if (result === "GOAL") return "GOAL!";
  if (result === "SAVE") return "SAVED!";
  if (result === "DRAW") return "DRAW";
  return "Waiting for result";
}

function resultSubheadline(result?: ShotResult): string {
  if (result === "GOAL") return "Net found — kicker wins the round.";
  if (result === "SAVE") return "Keeper read it — no goal.";
  if (result === "DRAW") return "Even round — no advantage.";
  return "";
}

function resultEmoji(result?: ShotResult): string {
  if (result === "GOAL") return "⚽";
  if (result === "SAVE") return "🧤";
  if (result === "DRAW") return "·";
  return "";
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
  const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(
    null
  );
  const disconnectCountdownRef = useRef<number | null>(null);
  const disconnectCountdownTickIntervalRef = useRef<number | null>(null);

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

  useEffect(() => {
    revealStageRef.current = revealStage;
  }, [revealStage]);

  function clearMatchResultRevealTimeout() {
    if (matchResultRevealTimeoutRef.current !== null) {
      window.clearTimeout(matchResultRevealTimeoutRef.current);
      matchResultRevealTimeoutRef.current = null;
    }
  }

  function clearDisconnectCountdownVisual() {
    if (disconnectCountdownTickIntervalRef.current !== null) {
      window.clearInterval(disconnectCountdownTickIntervalRef.current);
      disconnectCountdownTickIntervalRef.current = null;
    }
    disconnectCountdownRef.current = null;
    setDisconnectCountdown(null);
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

        if (disconnectCountdownRef.current !== null) {
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
        clearMatchResultRevealTimeout();
        lateResultRoundRef.current = null;
        closingRevealRoundSnapshotRef.current = null;
        matchResultRevealArmedRef.current = false;
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

      setStatus(data.message);

      const messageLower = data.message.toLowerCase();
      if (disconnectCountdownRef.current !== null) {
        if (messageLower.includes("opponent reconnected")) {
          clearDisconnectCountdownVisual();
        }
      }

      if (isReconnectForfeitCountdownStatusMessage(data.message)) {
        startDisconnectCountdownVisual(39);
      }

      if (data.phase) {
        setPhase(data.phase);
      }

      if (typeof data.suddenDeathRound === "number") {
        setSuddenDeathRound(data.suddenDeathRound);
      }

      if (typeof data.suddenRound === "number") {
        setSuddenDeathRound(data.suddenRound);
      }

      if (typeof data.timeoutSeconds === "number") {
        if (disconnectCountdownRef.current !== null) {
          clearDisconnectCountdownVisual();
        }

        const revealLocked =
          revealStageRef.current === "REVEALING" ||
          revealStageRef.current === "REVEALED";

        if (!revealLocked) {
          clearMatchResultRevealTimeout();
          matchResultRevealArmedRef.current = false;
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

      clearMatchResultRevealTimeout();
      closingRevealRoundSnapshotRef.current =
        authoritative.round ?? expectedRound ?? lastPickRoundRef.current;

      setOpponentStatus("Opponent locked their choice");
      setTimer(null);

      const bothLocked = Boolean(
        authoritative.kickerPick && authoritative.keeperPick
      );
      const revealDelayMs = bothLocked
        ? 0
        : tournamentContextRef.current.isTournament
          ? TOURNAMENT_MATCH_RESULT_REVEAL_MS
          : MATCH_RESULT_REVEAL_MS;

      if (revealDelayMs <= 0) {
        matchResultRevealArmedRef.current = false;
        applyRevealedResult(authoritative);
        return;
      }

      setPendingResult(authoritative);
      setRevealStage("REVEALING");
      setStatus("Both players locked. Revealing result...");
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
      clearMatchResultRevealTimeout();
      lateResultRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      matchResultRevealArmedRef.current = false;
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
      clearMatchResultRevealTimeout();
      lateResultRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      matchResultRevealArmedRef.current = false;
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

      clearMatchResultRevealTimeout();
      clearActiveMatch();
      setStatus("Match cancelled. No penalty applied.");

      clearAbortRedirectTimeout();
      abortRedirectTimeoutRef.current = window.setTimeout(() => {
        abortRedirectTimeoutRef.current = null;
        setRedirectingAfterAbort(true);
        router.push("/lobby");
      }, 2000);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:update", onRoomUpdate);
    socket.on("match:update", onMatchUpdate);
    socket.on("match:status", onMatchStatus);
    socket.on("match:result", onMatchResult);
    socket.on("match:end", onMatchEnd);
    socket.on("match:rematch:update", onRematchUpdate);
    socket.on("match:rematch:accepted", onRematchAccepted);
    socket.on("match:rematch:declined", onRematchDeclined);
    socket.on("match:aborted", onMatchAborted);
    socket.on("error:message", onErrorMessage);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.emit("room:leave", { roomCode: normalizedRoomCode });
      clearAbortRedirectTimeout();
      clearDisconnectCountdownVisual();
      clearMatchResultRevealTimeout();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:update", onRoomUpdate);
      socket.off("match:update", onMatchUpdate);
      socket.off("match:status", onMatchStatus);
      socket.off("match:result", onMatchResult);
      socket.off("match:end", onMatchEnd);
      socket.off("match:rematch:update", onRematchUpdate);
      socket.off("match:rematch:accepted", onRematchAccepted);
      socket.off("match:rematch:declined", onRematchDeclined);
      socket.off("match:aborted", onMatchAborted);
      socket.off("error:message", onErrorMessage);
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

    let secondsLeft = 3;
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

  const canPick =
    playerCount >= 2 &&
    !matchEnded &&
    !hasSubmittedPick &&
    revealStage !== "REVEALING" &&
    revealStage !== "REVEALED" &&
    !!identity;

  const matchEndOutcome = useMemo(() => {
    if (!matchEnded) return null;
    if (myScore > opponentScore) return "victory" as const;
    if (myScore < opponentScore) return "defeat" as const;
    return "draw" as const;
  }, [matchEnded, myScore, opponentScore]);

  const showLeaveMatchControls = useMemo(() => {
    return (
      !matchEnded &&
      !matchAborted &&
      !redirectingAfterAbort &&
      playerCount >= 2 &&
      !!identity &&
      matchStartedAt !== null &&
      earlyCancelDeadlineAt !== null
    );
  }, [
    matchEnded,
    matchAborted,
    redirectingAfterAbort,
    playerCount,
    identity,
    matchStartedAt,
    earlyCancelDeadlineAt,
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

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    clickSound.currentTime = 0;
    void clickSound.play().catch(() => {});

    socket.emit("match:pick", {
      roomCode: normalizedRoomCode,
      lane,
      playerId: identity.playerId,
    });

    resolvingPickRoundRef.current = lastPickRoundRef.current ?? round;
    setHasSubmittedPick(true);
    setMyPick(lane);
    setRevealStage("LOCKED");
    setOpponentStatus("Opponent is thinking...");
    setStatus(`You locked ${lane}. Waiting for opponent...`);
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

  const myRoleNow: Role | null = myPlayerId ? roles[myPlayerId] ?? null : null;
  const myFirstRoleLabel =
    myRoleNow === "KICKER"
      ? "You are Kicker first"
      : myRoleNow === "KEEPER"
        ? "You are Keeper first"
        : "Roles set in a moment";

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes tournamentArenaIn{0%{opacity:0;transform:translateY(10px) scale(0.97)}100%{opacity:1;transform:translateY(0) scale(1)}}@keyframes tournamentArenaCount{0%{opacity:0;transform:scale(0.6)}30%{opacity:1;transform:scale(1.05)}70%{opacity:1;transform:scale(1)}100%{opacity:0.85;transform:scale(0.95)}}@keyframes tournamentArenaBackdrop{from{opacity:0}to{opacity:1}}@keyframes tournamentIntroSlide{0%{opacity:0;transform:translateY(-6px)}15%{opacity:1;transform:translateY(0)}85%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-4px)}}.tournament-arena-overlay{animation:tournamentArenaBackdrop 0.2s ease-out forwards}.tournament-arena-card{animation:tournamentArenaIn 0.32s cubic-bezier(0.22,1,0.36,1) forwards}.tournament-arena-count{animation:tournamentArenaCount 1s ease-out forwards}.tournament-intro-pill{animation:tournamentIntroSlide 3s ease-out forwards}@keyframes matchScreenShake{0%,100%{transform:translate3d(0,0,0)}15%{transform:translate3d(-10px,0,0)}30%{transform:translate3d(10px,0,0)}45%{transform:translate3d(-8px,0,0)}60%{transform:translate3d(8px,0,0)}75%{transform:translate3d(-4px,0,0)}90%{transform:translate3d(4px,0,0)}}@keyframes matchTimerUrgentPulse{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0.45),0 0 24px rgba(248,113,113,0.18)}50%{box-shadow:0 0 0 10px rgba(248,113,113,0),0 0 36px rgba(248,113,113,0.42)}}@keyframes matchTimerUrgentScale{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}@keyframes matchSuddenDeathTimerGlow{0%,100%{box-shadow:0 0 18px rgba(250,204,21,0.18),inset 0 0 18px rgba(250,204,21,0.08)}50%{box-shadow:0 0 30px rgba(250,204,21,0.34),inset 0 0 24px rgba(250,204,21,0.12)}}@keyframes matchGoalFlash{0%{box-shadow:0 0 0 0 rgba(52,211,153,0.55)}100%{box-shadow:0 0 0 18px rgba(52,211,153,0)}}@keyframes matchSaveFlash{0%{box-shadow:0 0 0 0 rgba(249,115,22,0.5)}100%{box-shadow:0 0 0 16px rgba(249,115,22,0)}}@keyframes matchDrawFlash{0%{box-shadow:0 0 0 0 rgba(212,212,216,0.45)}100%{box-shadow:0 0 0 14px rgba(212,212,216,0)}}@keyframes matchResultReveal{0%{opacity:0.45;transform:translateY(10px) scale(0.98)}100%{opacity:1;transform:translateY(0) scale(1)}}@keyframes matchScorePulse{0%{transform:scale(1)}35%{transform:scale(1.28)}100%{transform:scale(1)}}@keyframes matchWaitingDot{0%,80%,100%{opacity:0.25;transform:scale(0.85)}40%{opacity:1;transform:scale(1.05)}}.match-timer-urgent{animation:matchTimerUrgentPulse 0.9s ease-in-out infinite,matchTimerUrgentScale 0.9s ease-in-out infinite}.match-timer-sudden-death{animation:matchSuddenDeathTimerGlow 1.4s ease-in-out infinite}.goal-flash{animation:matchGoalFlash 0.6s ease-out}.save-flash{animation:matchSaveFlash 0.6s ease-out}.draw-flash{animation:matchDrawFlash 0.5s ease-out}.match-result-reveal-active{animation:matchResultReveal 0.9s ease-out infinite alternate}.match-result-reveal-done{animation:matchResultReveal 0.45s ease-out}.match-result-headline-goal{text-shadow:0 0 24px rgba(52,211,153,0.45)}.match-result-headline-save{text-shadow:0 0 24px rgba(56,189,248,0.42)}.match-result-headline-draw{text-shadow:0 0 22px rgba(250,204,21,0.34)}.match-score-pulse{animation:matchScorePulse 0.45s cubic-bezier(0.22,1,0.36,1)}.match-lane-ready{transition:transform 180ms ease,box-shadow 180ms ease,background-color 180ms ease,border-color 180ms ease,color 180ms ease}.match-waiting-dots{display:inline-flex;align-items:center;gap:3px}.match-waiting-dot{display:inline-block;width:5px;height:5px;border-radius:9999px;background:currentColor;animation:matchWaitingDot 1.2s ease-in-out infinite}.match-waiting-dot:nth-child(2){animation-delay:0.18s}.match-waiting-dot:nth-child(3){animation-delay:0.36s}`,
        }}
      />
      {showTournamentStaging ? (
        <div
          className="tournament-arena-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-6 backdrop-blur-sm"
          aria-live="polite"
          aria-label="Match starting"
        >
          <div
            className={`tournament-arena-card w-full max-w-md overflow-hidden rounded-3xl border-2 px-5 py-7 text-center shadow-2xl sm:px-7 sm:py-8 ${
              isFinalTournamentMatch
                ? "border-yellow-300/70 bg-gradient-to-br from-yellow-950/70 via-amber-950/70 to-black shadow-[0_0_56px_rgba(234,179,8,0.32)]"
                : "border-amber-500/60 bg-gradient-to-br from-amber-950/55 via-zinc-950 to-black shadow-[0_0_42px_rgba(251,191,36,0.22)]"
            }`}
          >
            <p
              className={`text-[10px] font-black uppercase tracking-[0.32em] ${
                isFinalTournamentMatch ? "text-yellow-300" : "text-amber-300"
              }`}
            >
              {isFinalTournamentMatch ? "Championship match" : "Tournament match"}
            </p>
            <h2
              className={`mt-2 break-words text-2xl font-black tracking-tight sm:text-3xl ${
                isFinalTournamentMatch ? "text-yellow-100" : "text-white"
              }`}
            >
              {tournamentRoundDisplayLabel ?? "Match starting"}
            </h2>
            <div className="mt-4 flex items-center justify-center gap-2 text-sm font-bold text-zinc-200 sm:text-base">
              <span className="min-w-0 max-w-[40%] truncate text-white">
                {myName}
              </span>
              <span
                className={`shrink-0 text-[10px] font-black uppercase tracking-[0.28em] ${
                  isFinalTournamentMatch
                    ? "text-yellow-300"
                    : "text-amber-300"
                }`}
              >
                vs
              </span>
              <span className="min-w-0 max-w-[40%] truncate text-white">
                {opponentName}
              </span>
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-zinc-400 sm:text-sm">
              Match starting…
            </p>
            <p
              key={tournamentStagingCountdown}
              className={`tournament-arena-count mt-3 text-7xl font-black tabular-nums leading-none sm:text-8xl ${
                isFinalTournamentMatch ? "text-yellow-100" : "text-amber-100"
              }`}
            >
              {tournamentStagingCountdown && tournamentStagingCountdown > 0
                ? tournamentStagingCountdown
                : "GO"}
            </p>
            <p className="mt-4 text-[11px] font-semibold text-zinc-400">
              First to finish the shootout advances
            </p>
          </div>
        </div>
      ) : null}
      <div
        className={`main-container mx-auto max-w-6xl space-y-6 px-3 py-5 text-white sm:space-y-8 sm:px-4 sm:py-8 md:space-y-10 md:px-6 md:py-10 ${
          screenEffect === "GOAL"
            ? "zoom-impact scale-[1.06] transition-transform duration-300 ease-out ring-2 ring-green-400/80 shadow-[0_0_40px_rgba(34,197,94,0.55)]"
            : screenEffect === "SAVE"
              ? "shake-impact ring-2 ring-orange-500 shadow-[0_0_36px_rgba(249,115,22,0.55)] [animation:matchScreenShake_0.6s_ease-in-out]"
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

      <section className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-2 md:gap-6">
        <div className="min-w-0 rounded-3xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-xl sm:p-5 md:rounded-[2rem] md:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
            Your Score
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400 sm:text-sm md:mt-2">
            {myName}
          </p>
          <div className="mt-3 flex items-end justify-between gap-2 md:mt-4 md:gap-4">
            <p
              className={`text-5xl font-black tabular-nums transition-all duration-500 ease-out sm:text-6xl md:text-7xl ${
                scorePulse === "p1"
                  ? "match-score-pulse scale-[1.24] text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.65)]"
                  : "text-white"
              }`}
            >
              {myScore}
            </p>
            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-black sm:px-3 sm:py-1 sm:text-xs">
              YOU
            </span>
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-xl sm:p-5 md:rounded-[2rem] md:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
            Opponent
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400 sm:text-sm md:mt-2">
            {opponentName}
          </p>
          <div className="mt-3 flex items-end justify-between gap-2 md:mt-4 md:gap-4">
            <p
              className={`text-5xl font-black tabular-nums transition-all duration-500 ease-out sm:text-6xl md:text-7xl ${
                scorePulse === "p2"
                  ? "match-score-pulse scale-[1.24] text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.65)]"
                  : "text-white"
              }`}
            >
              {opponentScore}
            </p>
            <span className="shrink-0 rounded-full border border-zinc-600 px-2 py-0.5 text-[10px] font-black text-zinc-300 sm:px-3 sm:py-1 sm:text-xs">
              OPP
            </span>
          </div>
        </div>
      </section>

      {!matchEnded ? (
        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/95 p-5 shadow-xl md:p-7">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black md:text-3xl">
                {hasSubmittedPick || myPick ? "Pick locked in" : "Choose your lane"}
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
              {(hasSubmittedPick || myPick) && !isRevealLocked ? (
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
              className={`mt-3 inline-flex items-center gap-3 text-4xl font-black transition-all duration-300 md:text-6xl ${resultHeadlineClass(
                shownResult?.result,
                revealStage
              )}`}
            >
              {revealStage === "REVEALING" ? (
                "Revealing…"
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
            Match Complete
          </p>

          <h2
            className={`mt-3 break-words text-4xl font-black tracking-tight sm:text-5xl md:mt-4 md:text-6xl ${
              isFinalTournamentMatch && matchEndOutcome === "victory"
                ? "bg-gradient-to-r from-yellow-200 via-amber-200 to-orange-200 bg-clip-text text-transparent drop-shadow-[0_0_32px_rgba(234,179,8,0.5)]"
                : matchEndOutcome === "victory"
                  ? "bg-gradient-to-r from-emerald-200 via-emerald-100 to-amber-200 bg-clip-text text-transparent drop-shadow-[0_0_24px_rgba(52,211,153,0.35)]"
                  : matchEndOutcome === "defeat"
                    ? "text-red-100 drop-shadow-[0_0_20px_rgba(248,113,113,0.25)]"
                    : "text-yellow-100 drop-shadow-[0_0_18px_rgba(250,204,21,0.2)]"
            }`}
          >
            {isTournamentMatch
              ? matchEndOutcome === "victory"
                ? isFinalTournamentMatch
                  ? "Champion!"
                  : "You advanced"
                : matchEndOutcome === "defeat"
                  ? "You were eliminated"
                  : "Match drawn"
              : matchEndOutcome === "victory"
                ? "Victory"
                : matchEndOutcome === "defeat"
                  ? "Defeat"
                  : "Draw"}
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
            {isTournamentMatch
              ? matchEndOutcome === "victory"
                ? isFinalTournamentMatch
                  ? `You beat ${opponentName} to win the tournament.`
                  : `You beat ${opponentName}. On to the next round.`
                : matchEndOutcome === "defeat"
                  ? isFinalTournamentMatch
                    ? `${opponentName} took the final. Great run.`
                    : `${opponentName} took this one. Your run ends here.`
                  : "Match split. Returning to tournament."
              : matchEndOutcome === "victory"
                ? `You outscored ${opponentName}.`
                : matchEndOutcome === "defeat"
                  ? `${opponentName} took this one.`
                  : "Nothing separated both players."}
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