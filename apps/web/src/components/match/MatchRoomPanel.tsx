"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { clearActiveMatch } from "../../lib/match/activeMatch";
import {
  getCurrentPlayerIdentity,
  type PlayerIdentity,
} from "../../lib/auth/playerIdentity";

type Lane = "LEFT" | "CENTER" | "RIGHT";
type Role = "KICKER" | "KEEPER";
type ShotResult = "GOAL" | "SAVE" | "DRAW";
type MatchPhase = "NORMAL" | "SUDDEN_DEATH";
type RevealStage = "IDLE" | "LOCKED" | "REVEALING" | "REVEALED";

type MatchResultPayload = {
  kickerPick: Lane | null;
  keeperPick: Lane | null;
  result: ShotResult;
  statusMessage?: string;
};

type MatchUpdatePayload = {
  roles: Record<string, Role>;
  playerNames?: Record<string, string>;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  matchEnded?: boolean;
  phase?: MatchPhase;
  suddenDeathRound?: number;
  suddenRound?: number;
};

type MatchEndPayload = {
  scores: Record<string, number>;
};

type RematchUpdatePayload = {
  votes: number;
  required: number;
};

type MatchStatusPayload = {
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
  if (result === "SAVE") return "SAVE!";
  if (result === "DRAW") return "DRAW!";
  return "Waiting for result";
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
  const [playerCount, setPlayerCount] = useState(1);
  const [timer, setTimer] = useState<number | null>(null);
  const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(
    null
  );
  const disconnectCountdownRef = useRef<number | null>(null);
  const disconnectCountdownTickIntervalRef = useRef<number | null>(null);

  const lastPickRoundRef = useRef<number | null>(null);
  const matchResultRevealTimeoutRef = useRef<number | null>(null);
  /** True after match:pick window advanced without a reveal timer armed (duplicate reorder). */
  const staleReorderMatchResultRef = useRef(false);
  /** True while the 900ms match:result reveal timer is armed (canonical result-before-update ordering). */
  const matchResultRevealArmedRef = useRef(false);
  /** Highest pick round we've finished resolving (timer reveal or reorder discard). */
  const lastFullyRevealedPickRoundRef = useRef(0);
  /** Closing pick round captured when arming reveal (canonical ordering). */
  const closingRevealRoundSnapshotRef = useRef<number | null>(null);
  /** Closing pick round stored when reorder advance runs before trailing match:result. */
  const staleReorderClosingRoundRef = useRef<number | null>(null);
  const previousScoresForPulseRef = useRef<Record<string, number>>({});

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
      socket.emit("room:join", {
        roomCode,
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
    }) {
      setPlayerCount(payload.playerCount);
      setPlayerOrder(payload.players);

      if (payload.roles) {
        setRoles(payload.roles);
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

      setRoles(data.roles);
      setScores(data.scores);
      setDisplayScores(data.scores);
      setRound(incomingRound);
      setMaxRounds(data.maxRounds);
      setPhase(inferredPhase);
      setSuddenDeathRound(inferredSuddenRound);

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
            staleReorderMatchResultRef.current = true;
            staleReorderClosingRoundRef.current = prev;
          } else {
            staleReorderMatchResultRef.current = false;
            staleReorderClosingRoundRef.current = null;
          }

          matchResultRevealArmedRef.current = false;
        }

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
        if (disconnectCountdownRef.current !== null) {
          clearDisconnectCountdownVisual();
        }
        clearMatchResultRevealTimeout();
        staleReorderMatchResultRef.current = false;
        staleReorderClosingRoundRef.current = null;
        closingRevealRoundSnapshotRef.current = null;
        matchResultRevealArmedRef.current = false;
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
        // New pick window countdown from server — cancel stray reveal timeout so
        // a prior round match:result timer cannot force REVEALED during this countdown.
        clearMatchResultRevealTimeout();
        matchResultRevealArmedRef.current = false;
        setRevealStage("IDLE");
        setHasSubmittedPick(false);
        setOpponentStatus("");
        setTimer(data.timeoutSeconds);
      }
    }

    function onMatchResult(data: MatchResultPayload) {
      if (staleReorderMatchResultRef.current) {
        staleReorderMatchResultRef.current = false;
        clearMatchResultRevealTimeout();

        const closedAt = staleReorderClosingRoundRef.current;
        staleReorderClosingRoundRef.current = null;

        if (closedAt !== null) {
          lastFullyRevealedPickRoundRef.current = Math.max(
            lastFullyRevealedPickRoundRef.current,
            closedAt
          );
        }

        return;
      }

      clearMatchResultRevealTimeout();

      closingRevealRoundSnapshotRef.current = lastPickRoundRef.current;

      setOpponentStatus("Opponent locked their choice");
      setPendingResult(data);
      setRevealStage("REVEALING");
      setStatus("Both players locked. Revealing result...");
      setTimer(null);

      matchResultRevealArmedRef.current = true;

      matchResultRevealTimeoutRef.current = window.setTimeout(() => {
        matchResultRevealTimeoutRef.current = null;
        matchResultRevealArmedRef.current = false;

        const snap = closingRevealRoundSnapshotRef.current;
        closingRevealRoundSnapshotRef.current = null;

        if (snap !== null) {
          lastFullyRevealedPickRoundRef.current = Math.max(
            lastFullyRevealedPickRoundRef.current,
            snap
          );
        }

        setResult(data);
        setRevealStage("REVEALED");
        setStatus(data.statusMessage || `Result: ${data.result}`);
        setResultFlavorMessage(pickResultFlavorMessage(data.result));
        setOpponentStatus("");

        if (data.result === "GOAL") {
          goalSound.currentTime = 0;
          void goalSound.play().catch(() => {});
        } else if (data.result === "SAVE") {
          saveSound.currentTime = 0;
          void saveSound.play().catch(() => {});
        }

        if (data.result === "GOAL") {
          setImpactResult("GOAL");
          window.setTimeout(() => {
            setImpactResult(null);
          }, 600);
        } else if (data.result === "SAVE") {
          setImpactResult("SAVE");
          window.setTimeout(() => {
            setImpactResult(null);
          }, 600);
        } else if (data.result === "DRAW") {
          setImpactResult("DRAW");
          window.setTimeout(() => {
            setImpactResult(null);
          }, 500);
        }

        if (data.result === "GOAL") {
          setScreenEffect("GOAL");
          window.setTimeout(() => {
            setScreenEffect(null);
          }, 600);
        } else if (data.result === "SAVE") {
          setScreenEffect("SAVE");
          window.setTimeout(() => {
            setScreenEffect(null);
          }, 600);
        } else if (data.result === "DRAW") {
          setScreenEffect("DRAW");
          window.setTimeout(() => {
            setScreenEffect(null);
          }, 500);
        }
      }, 900);
    }

    function onMatchEnd(payload: MatchEndPayload) {
      if (disconnectCountdownRef.current !== null) {
        clearDisconnectCountdownVisual();
      }
      clearMatchResultRevealTimeout();
      staleReorderMatchResultRef.current = false;
      staleReorderClosingRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      matchResultRevealArmedRef.current = false;
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
    }

    function onRematchUpdate(payload: RematchUpdatePayload) {
      setRematchVotes(payload.votes);
      setRematchRequired(payload.required);
      setStatus(`Rematch votes: ${payload.votes}/${payload.required}`);
    }

    function onRematchAccepted() {
      if (disconnectCountdownRef.current !== null) {
        clearDisconnectCountdownVisual();
      }
      clearMatchResultRevealTimeout();
      staleReorderMatchResultRef.current = false;
      staleReorderClosingRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      matchResultRevealArmedRef.current = false;
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
      setRematchRequested(false);
      setRevealStage("IDLE");
      setPhase("NORMAL");
      setSuddenDeathRound(0);
      setStatus("Rematch started");
    }

    function onErrorMessage(payload: { message: string }) {
      setStatus(payload.message);
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
    socket.on("error:message", onErrorMessage);

    if (socket.connected) {
      onConnect();
    }

    return () => {
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
      socket.off("error:message", onErrorMessage);
    };
  }, [roomCode, identity]);

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

  function pick(lane: Lane) {
    if (!canPick || !identity) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    clickSound.currentTime = 0;
    void clickSound.play().catch(() => {});

    socket.emit("match:pick", {
      roomCode,
      lane,
      playerId: identity.playerId,
    });

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
    setStatus("Rematch requested...");
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes matchScreenShake{0%,100%{transform:translate3d(0,0,0)}15%{transform:translate3d(-10px,0,0)}30%{transform:translate3d(10px,0,0)}45%{transform:translate3d(-8px,0,0)}60%{transform:translate3d(8px,0,0)}75%{transform:translate3d(-4px,0,0)}90%{transform:translate3d(4px,0,0)}}@keyframes matchTimerUrgentPulse{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0.45),0 0 24px rgba(248,113,113,0.18)}50%{box-shadow:0 0 0 10px rgba(248,113,113,0),0 0 36px rgba(248,113,113,0.42)}}@keyframes matchTimerUrgentScale{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}@keyframes matchSuddenDeathTimerGlow{0%,100%{box-shadow:0 0 18px rgba(250,204,21,0.18),inset 0 0 18px rgba(250,204,21,0.08)}50%{box-shadow:0 0 30px rgba(250,204,21,0.34),inset 0 0 24px rgba(250,204,21,0.12)}}@keyframes matchGoalFlash{0%{box-shadow:0 0 0 0 rgba(52,211,153,0.55)}100%{box-shadow:0 0 0 18px rgba(52,211,153,0)}}@keyframes matchSaveFlash{0%{box-shadow:0 0 0 0 rgba(249,115,22,0.5)}100%{box-shadow:0 0 0 16px rgba(249,115,22,0)}}@keyframes matchDrawFlash{0%{box-shadow:0 0 0 0 rgba(212,212,216,0.45)}100%{box-shadow:0 0 0 14px rgba(212,212,216,0)}}@keyframes matchResultReveal{0%{opacity:0.45;transform:translateY(10px) scale(0.98)}100%{opacity:1;transform:translateY(0) scale(1)}}@keyframes matchScorePulse{0%{transform:scale(1)}35%{transform:scale(1.28)}100%{transform:scale(1)}}.match-timer-urgent{animation:matchTimerUrgentPulse 0.9s ease-in-out infinite,matchTimerUrgentScale 0.9s ease-in-out infinite}.match-timer-sudden-death{animation:matchSuddenDeathTimerGlow 1.4s ease-in-out infinite}.goal-flash{animation:matchGoalFlash 0.6s ease-out}.save-flash{animation:matchSaveFlash 0.6s ease-out}.draw-flash{animation:matchDrawFlash 0.5s ease-out}.match-result-reveal-active{animation:matchResultReveal 0.9s ease-out infinite alternate}.match-result-reveal-done{animation:matchResultReveal 0.45s ease-out}.match-result-headline-goal{text-shadow:0 0 24px rgba(52,211,153,0.45)}.match-result-headline-save{text-shadow:0 0 24px rgba(56,189,248,0.42)}.match-result-headline-draw{text-shadow:0 0 22px rgba(250,204,21,0.34)}.match-score-pulse{animation:matchScorePulse 0.45s cubic-bezier(0.22,1,0.36,1)}.match-lane-ready{transition:transform 180ms ease,box-shadow 180ms ease,background-color 180ms ease,border-color 180ms ease,color 180ms ease}`,
        }}
      />
      <div
        className={`main-container mx-auto max-w-6xl space-y-8 px-4 py-8 text-white md:space-y-10 md:px-6 md:py-10 ${
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
        <div className="border-b border-zinc-800 px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
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

              <h1 className="mt-4 text-3xl font-black md:text-5xl">
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
              <p className="text-xs text-yellow-400">{opponentStatus}</p>
              {disconnectCountdown !== null ? (
                <div className="mt-2 max-w-2xl rounded-xl border border-red-500/40 bg-red-950/35 px-3 py-2">
                  <p className="text-sm font-semibold text-red-200">
                    Opponent disconnected. Aborting match in{" "}
                    {disconnectCountdown}s...
                  </p>
                </div>
              ) : null}
            </div>

            <div
              className={`min-w-[9.5rem] rounded-3xl border px-6 py-5 text-center shadow-lg transition-all duration-300 ${
                isTimerUrgent
                  ? "match-timer-urgent border-red-400/90 bg-red-500/20"
                  : isSuddenDeath
                    ? "match-timer-sudden-death border-yellow-400/80 bg-yellow-500/15"
                    : "border-zinc-700 bg-zinc-900"
              }`}
            >
              <p
                className={`text-xs font-bold uppercase tracking-[0.2em] ${
                  isTimerUrgent
                    ? "text-red-200"
                    : isSuddenDeath
                      ? "text-yellow-200/90"
                      : "text-zinc-400"
                }`}
              >
                Timer
              </p>
              <p
                className={`mt-1 text-5xl font-black tabular-nums transition-transform duration-300 ${
                  isTimerUrgent
                    ? "text-red-200"
                    : isSuddenDeath
                      ? "text-yellow-100"
                      : "text-white"
                }`}
              >
                {timer !== null ? timer : "-"}
              </p>
              <p
                className={`text-xs ${
                  isTimerUrgent
                    ? "text-red-200/80"
                    : isSuddenDeath
                      ? "text-yellow-200/70"
                      : "text-zinc-500"
                }`}
              >
                seconds
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-4">
          <div className="rounded-3xl border border-zinc-800 bg-black/40 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              Your Role
            </p>
            <p className="mt-3 text-2xl font-black">{myRole || "-"}</p>
          </div>

          <div
            className={`rounded-3xl border bg-black/40 p-5 ${
              isSuddenDeath
                ? "border-amber-400/45 shadow-[inset_0_0_24px_rgba(251,191,36,0.06)]"
                : isLateGame
                  ? "border-red-400/30"
                  : "border-zinc-800"
            }`}
          >
            <p
              className={`text-xs font-bold uppercase tracking-[0.18em] ${
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
              className={`mt-3 font-black ${
                isSuddenDeath
                  ? "text-3xl text-amber-200 md:text-4xl"
                  : isLateGame
                    ? "text-2xl text-zinc-100"
                    : "text-2xl"
              }`}
            >
              {roundLabel}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-black/40 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              Players
            </p>
            <p className="mt-3 text-2xl font-black">{playerCount}/2</p>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-black/40 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              Pick Status
            </p>
            <p className="mt-3 text-2xl font-black">
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
        <section className="rounded-[2rem] border border-yellow-400 bg-yellow-500/10 p-6 shadow-xl">
          <p className="text-sm font-black uppercase tracking-[0.3em] text-yellow-300">
            Sudden Death
          </p>
          <h2 className="mt-2 text-3xl font-black">
            One clean cycle decides everything.
          </h2>
          <p className="mt-2 text-yellow-100">
            Both players were tied after normal rounds. Score while your
            opponent fails and the match ends.
          </p>
        </section>
      ) : null}

      <section className="grid gap-5 md:grid-cols-2 md:gap-6">
        <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/95 p-7 shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
            Your Score
          </p>
          <p className="mt-2 text-sm text-zinc-400">{myName}</p>
          <div className="mt-4 flex items-end justify-between gap-4">
            <p
              className={`text-7xl font-black tabular-nums transition-all duration-500 ease-out ${
                scorePulse === "p1"
                  ? "match-score-pulse scale-[1.24] text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.65)]"
                  : "text-white"
              }`}
            >
              {myScore}
            </p>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-black">
              YOU
            </span>
          </div>
        </div>

        <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950/95 p-7 shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
            Opponent Score
          </p>
          <p className="mt-2 text-sm text-zinc-400">{opponentName}</p>
          <div className="mt-4 flex items-end justify-between gap-4">
            <p
              className={`text-7xl font-black tabular-nums transition-all duration-500 ease-out ${
                scorePulse === "p2"
                  ? "match-score-pulse scale-[1.24] text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.65)]"
                  : "text-white"
              }`}
            >
              {opponentScore}
            </p>
            <span className="rounded-full border border-zinc-600 px-3 py-1 text-xs font-black text-zinc-300">
              OPPONENT
            </span>
          </div>
        </div>
      </section>

      {!matchEnded ? (
        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/95 p-7 shadow-xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black">
                {hasSubmittedPick || myPick ? "Pick Locked" : "Choose Your Lane"}
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                {hasSubmittedPick || myPick
                  ? `You selected ${myPick ?? "your lane"}. Waiting for the other player.`
                  : "Pick LEFT, CENTER, or RIGHT before the timer expires."}
              </p>
            </div>

            {myRole ? (
              <span className="rounded-full border border-zinc-700 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-300">
                Playing as {myRole}
              </span>
            ) : null}
          </div>

          <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-3">
            {LANES.map((lane) => (
              <button
                key={lane}
                onClick={() => pick(lane)}
                disabled={!canPick}
                className={`group rounded-3xl border px-5 py-8 text-center ${getLaneButtonClass(
                  lane,
                  {
                    canPick,
                    myPick,
                    isSuddenDeath,
                    revealStage,
                  }
                )}`}
              >
                <p className="text-5xl font-black">{laneEmoji(lane)}</p>
                <p className="mt-3 text-lg font-black">{lane}</p>
                {myPick === lane ? (
                  <p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
                    Locked
                  </p>
                ) : isRevealLocked ? (
                  <p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                    Reveal in progress
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className={`rounded-[2rem] border p-7 shadow-2xl transition-all duration-300 ${resultStyle(
          shownResult?.result
        )} ${
          revealStage === "REVEALED"
            ? "match-result-reveal-done"
            : revealStage === "REVEALING"
              ? "match-result-reveal-active"
              : ""
        }`}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="md:max-w-xl">
            <p className="text-xs font-black uppercase tracking-[0.25em] text-white/60">
              Current Result
            </p>

            <h2
              className={`mt-3 text-4xl font-black transition-all duration-300 md:text-5xl ${resultHeadlineClass(
                shownResult?.result,
                revealStage
              )}`}
            >
              {revealStage === "REVEALING"
                ? "Revealing..."
                : resultLabel(shownResult?.result)}
            </h2>

            {revealStage !== "REVEALING" && resultFlavorMessage ? (
              <p className="mt-2 text-sm font-medium italic text-white/70">
                {resultFlavorMessage}
              </p>
            ) : null}

            {shownResult?.statusMessage ? (
              <p className="mt-3 text-sm text-white/80">
                {shownResult.statusMessage}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm md:w-[440px]">
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
                Kicker
              </p>
              <p className="mt-2 text-3xl font-black">
                {shownResult?.kickerPick
                  ? `${laneEmoji(shownResult.kickerPick)} ${
                      shownResult.kickerPick
                    }`
                  : "-"}
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
                Keeper
              </p>
              <p className="mt-2 text-3xl font-black">
                {shownResult?.keeperPick
                  ? `${laneEmoji(shownResult.keeperPick)} ${
                      shownResult.keeperPick
                    }`
                  : "-"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {matchEnded ? (
        <section className="rounded-[2rem] border border-emerald-400 bg-emerald-500/10 p-6 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-emerald-300">
            Match Complete
          </p>

          <h2 className="mt-2 text-4xl font-black">
            Final Score: {myName} {myScore} - {opponentScore} {opponentName}
          </h2>

          <p className="mt-3 text-sm text-emerald-100">
            Rematch votes: {rematchVotes}/{rematchRequired}
          </p>

          <div className="mt-6 flex flex-col gap-3 md:flex-row">
            <button
              onClick={requestRematch}
              disabled={rematchRequested || !identity}
              className="rounded-2xl bg-white px-5 py-4 font-black text-black disabled:opacity-50"
            >
              {rematchRequested ? "Rematch Requested" : "Rematch"}
            </button>

            <a
              href="/lobby"
              className="rounded-2xl border border-white/30 px-5 py-4 text-center font-black text-white hover:bg-white hover:text-black"
            >
              Back to Lobby
            </a>
          </div>
        </section>
      ) : null}
      </div>
    </>
  );
}