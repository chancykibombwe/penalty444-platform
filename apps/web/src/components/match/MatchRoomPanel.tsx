"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function laneEmoji(lane: Lane) {
  if (lane === "LEFT") return "↙";
  if (lane === "CENTER") return "⬆";
  return "↘";
}

function resultStyle(result?: ShotResult) {
  if (result === "GOAL") {
    return "border-emerald-400 bg-emerald-500/15 text-emerald-300";
  }

  if (result === "SAVE") {
    return "border-sky-400 bg-sky-500/15 text-sky-300";
  }

  if (result === "DRAW") {
    return "border-yellow-400 bg-yellow-500/15 text-yellow-300";
  }

  return "border-zinc-800 bg-zinc-900 text-white";
}

function resultLabel(result?: ShotResult) {
  if (result === "GOAL") return "GOAL!";
  if (result === "SAVE") return "SAVE!";
  if (result === "DRAW") return "DRAW!";
  return "Waiting for result";
}

export default function MatchRoomPanel({ roomCode }: { roomCode: string }) {
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
  const [connected, setConnected] = useState(false);
  const [matchEnded, setMatchEnded] = useState(false);
  const [playerCount, setPlayerCount] = useState(1);
  const [timer, setTimer] = useState<number | null>(null);

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

  function clearMatchResultRevealTimeout() {
    if (matchResultRevealTimeoutRef.current !== null) {
      window.clearTimeout(matchResultRevealTimeoutRef.current);
      matchResultRevealTimeoutRef.current = null;
    }
  }

  const [finalScores, setFinalScores] = useState<Record<string, number> | null>(
    null
  );

  const [rematchVotes, setRematchVotes] = useState(0);
  const [rematchRequired, setRematchRequired] = useState(2);
  const [rematchRequested, setRematchRequested] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadIdentity() {
      const currentIdentity = await getCurrentPlayerIdentity();

      if (!isMounted) return;

      setIdentity(currentIdentity);
    }

    loadIdentity();

    return () => {
      isMounted = false;
    };
  }, []);

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

      const normalTurns = data.maxRounds * 2;
      const inferredPhase: MatchPhase =
        data.phase || data.round > normalTurns ? "SUDDEN_DEATH" : "NORMAL";

      const inferredSuddenRound =
        data.suddenDeathRound ||
        data.suddenRound ||
        (data.round > normalTurns
          ? Math.max(1, Math.ceil((data.round - normalTurns) / 2))
          : 0);

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
        setRevealStage("IDLE");
      }

      if (data.playerNames) {
        setPlayerNames(data.playerNames);
      }

      if (data.matchEnded) {
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
        return;
      }

      setMatchEnded(false);
      setFinalScores(null);
    }

    function onMatchStatus(data: MatchStatusPayload) {
      setStatus(data.message);

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
        // New pick window countdown from server — cancel stray reveal timeout so
        // a prior round match:result timer cannot force REVEALED during this countdown.
        clearMatchResultRevealTimeout();
        matchResultRevealArmedRef.current = false;
        setRevealStage("IDLE");
        setHasSubmittedPick(false);
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
      }, 900);
    }

    function onMatchEnd(payload: MatchEndPayload) {
      clearMatchResultRevealTimeout();
      staleReorderMatchResultRef.current = false;
      staleReorderClosingRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      matchResultRevealArmedRef.current = false;
      lastFullyRevealedPickRoundRef.current = 0;
      lastPickRoundRef.current = null;
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
      clearMatchResultRevealTimeout();
      staleReorderMatchResultRef.current = false;
      staleReorderClosingRoundRef.current = null;
      closingRevealRoundSnapshotRef.current = null;
      matchResultRevealArmedRef.current = false;
      lastFullyRevealedPickRoundRef.current = 0;
      lastPickRoundRef.current = null;
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
  const isSuddenDeath = phase === "SUDDEN_DEATH" || round > normalTurns;

  const roundLabel = isSuddenDeath
    ? `Sudden Death ${
        suddenDeathRound || Math.max(1, Math.ceil((round - normalTurns) / 2))
      }`
    : `${round} / ${normalTurns}`;

  const phaseLabel = isSuddenDeath ? "SUDDEN DEATH" : "NORMAL MATCH";

  const shownResult = result || pendingResult;

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

    socket.emit("match:pick", {
      roomCode,
      lane,
      playerId: identity.playerId,
    });

    setHasSubmittedPick(true);
    setMyPick(lane);
    setRevealStage("LOCKED");
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
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 text-white">
      <section className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-black shadow-2xl">
        <div className="border-b border-zinc-800 px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.2em] ${
                    isSuddenDeath
                      ? "bg-yellow-400 text-black"
                      : "bg-emerald-400 text-black"
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
                {myName} <span className="text-zinc-500">vs</span>{" "}
                {opponentName}
              </h1>

              <p className="mt-3 max-w-2xl text-sm text-zinc-400">{status}</p>
            </div>

            <div
              className={`rounded-3xl border px-6 py-5 text-center ${
                timer !== null && timer <= 3
                  ? "border-red-400 bg-red-500/15"
                  : isSuddenDeath
                    ? "border-yellow-400 bg-yellow-500/15"
                    : "border-zinc-700 bg-zinc-900"
              }`}
            >
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                Timer
              </p>
              <p
                className={`mt-1 text-5xl font-black ${
                  timer !== null && timer <= 3 ? "text-red-300" : "text-white"
                }`}
              >
                {timer !== null ? timer : "-"}
              </p>
              <p className="text-xs text-zinc-500">seconds</p>
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

          <div className="rounded-3xl border border-zinc-800 bg-black/40 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              Round
            </p>
            <p
              className={`mt-3 text-2xl font-black ${
                isSuddenDeath ? "text-yellow-300" : ""
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

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-xl">
          <p className="text-sm text-zinc-400">{myName}</p>
          <div className="mt-3 flex items-end justify-between">
            <p className="text-7xl font-black transition-transform duration-300">
              {myScore}
            </p>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-black">
              YOU
            </span>
          </div>
        </div>

        <div className="rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-xl">
          <p className="text-sm text-zinc-400">{opponentName}</p>
          <div className="mt-3 flex items-end justify-between">
            <p className="text-7xl font-black transition-transform duration-300">
              {opponentScore}
            </p>
            <span className="rounded-full border border-zinc-600 px-3 py-1 text-xs font-black text-zinc-300">
              OPPONENT
            </span>
          </div>
        </div>
      </section>

      {!matchEnded ? (
        <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
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

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {LANES.map((lane) => (
              <button
                key={lane}
                onClick={() => pick(lane)}
                disabled={!canPick}
                className={`group rounded-3xl border px-5 py-8 text-center transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                  myPick === lane
                    ? "scale-[1.02] border-emerald-400 bg-emerald-500/15 shadow-lg shadow-emerald-500/20"
                    : isSuddenDeath
                      ? "border-yellow-500/70 bg-black/30 hover:bg-yellow-400 hover:text-black"
                      : "border-zinc-700 bg-black/30 hover:border-white hover:bg-white hover:text-black"
                }`}
              >
                <p className="text-5xl font-black">{laneEmoji(lane)}</p>
                <p className="mt-3 text-lg font-black">{lane}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className={`rounded-[2rem] border p-6 shadow-xl transition-all duration-300 ${resultStyle(
          shownResult?.result
        )}`}
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] opacity-70">
              Current Result
            </p>

            <h2
              className={`mt-2 text-4xl font-black transition-all duration-300 ${
                revealStage === "REVEALING" ? "animate-pulse opacity-70" : ""
              }`}
            >
              {revealStage === "REVEALING"
                ? "Revealing..."
                : resultLabel(shownResult?.result)}
            </h2>

            {shownResult?.statusMessage ? (
              <p className="mt-2 text-sm opacity-80">
                {shownResult.statusMessage}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm md:w-[420px]">
            <div
              className={`rounded-2xl border border-white/10 bg-black/20 p-4 transition-all duration-300 ${
                revealStage === "REVEALED" ? "scale-[1.03]" : ""
              }`}
            >
              <p className="text-xs opacity-60">Kicker</p>
              <p className="mt-1 text-3xl font-black">
                {shownResult?.kickerPick
                  ? `${laneEmoji(shownResult.kickerPick)} ${
                      shownResult.kickerPick
                    }`
                  : "-"}
              </p>
            </div>

            <div
              className={`rounded-2xl border border-white/10 bg-black/20 p-4 transition-all duration-300 ${
                revealStage === "REVEALED" ? "scale-[1.03]" : ""
              }`}
            >
              <p className="text-xs opacity-60">Keeper</p>
              <p className="mt-1 text-3xl font-black">
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
  );
}