/**
 * DEV-ONLY — Unity / 3D prototype sandbox.
 *
 * This route exists to validate the postMessage bridge contract defined in
 * docs/unity-3d-prototype-plan.md before any Unity build is available. It
 * mounts a mock canvas that echoes Unity outbound events so engineers can
 * wire up and test the React side of the bridge in isolation.
 *
 * NOT linked from the main nav. NOT shown to users. NOT in production paths.
 * Remove this page before enabling NEXT_PUBLIC_UNITY_MATCH_ENABLED for real users.
 *
 * Constraints (see docs/unity-3d-prototype-plan.md §11):
 *   - No Supabase reads or writes.
 *   - No Socket.IO connections.
 *   - No auth tokens read or displayed.
 *   - No match result logic.
 */

"use client";

import { useEffect, useRef, useState } from "react";

type RoundResultPayload = {
  kickerLane: "LEFT" | "CENTER" | "RIGHT";
  keeperLane: "LEFT" | "CENTER" | "RIGHT";
  result: "GOAL" | "SAVE" | "DRAW";
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  phase: "NORMAL" | "SUDDEN_DEATH";
};

type UnityInbound =
  | { type: "PENALTY444_MATCH_EVENT"; event: "round_result"; payload: RoundResultPayload }
  | { type: "PENALTY444_MATCH_EVENT"; event: "match_end"; payload: { winnerId: string | null; isDraw: boolean } }
  | { type: "PENALTY444_MATCH_EVENT"; event: "staging_begin"; payload: { startsAt: number } }
  | { type: "PENALTY444_MATCH_EVENT"; event: "reset"; payload: null };

type UnityOutbound =
  | { type: "PENALTY444_UNITY_EVENT"; event: "animation_complete"; payload: { round: number } }
  | { type: "PENALTY444_UNITY_EVENT"; event: "ready"; payload: null }
  | { type: "PENALTY444_UNITY_EVENT"; event: "error"; payload: { message: string } };

type LogEntry = { direction: "in" | "out"; event: string; payload: unknown; ts: number };

// Mock canvas that simulates Unity responding to events.
function MockUnityCanvas({
  onMessage,
  sendToReact,
}: {
  onMessage: (msg: UnityInbound) => void;
  sendToReact: (msg: UnityOutbound) => void;
}) {
  const [lastEvent, setLastEvent] = useState<string>("Waiting for events…");

  useEffect(() => {
    sendToReact({ type: "PENALTY444_UNITY_EVENT", event: "ready", payload: null });
  }, [sendToReact]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as UnityInbound;
      if (msg?.type !== "PENALTY444_MATCH_EVENT") return;
      onMessage(msg);
      setLastEvent(`← ${msg.event}`);
      if (msg.event === "round_result") {
        const p = msg.payload as RoundResultPayload;
        const label = p.result === "GOAL" ? "⚽ GOAL" : p.result === "SAVE" ? "🧤 SAVE" : "↗ MISS";
        setLastEvent(`← round_result  ${label}  (round ${p.round}/${p.maxRounds})`);
        setTimeout(() => {
          sendToReact({
            type: "PENALTY444_UNITY_EVENT",
            event: "animation_complete",
            payload: { round: p.round },
          });
        }, 800);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onMessage, sendToReact]);

  return (
    <div
      className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-cyan-700/60 bg-black/60"
      aria-label="Mock Unity canvas"
    >
      <div className="text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-600">
          Mock Unity Canvas
        </p>
        <p className="mt-2 font-mono text-sm text-cyan-200">{lastEvent}</p>
        <p className="mt-1 text-[10px] text-zinc-600">
          Responds to round_result with animation_complete after 800 ms
        </p>
      </div>
    </div>
  );
}

export default function UnityPrototypePage() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [round, setRound] = useState(1);
  const logRef = useRef<HTMLDivElement>(null);

  function pushLog(entry: LogEntry) {
    setLog((prev) => [entry, ...prev].slice(0, 50));
  }

  function postToCanvas(msg: UnityInbound) {
    window.postMessage(msg, window.location.origin);
    pushLog({ direction: "in", event: msg.event, payload: msg.payload, ts: Date.now() });
  }

  function handleUnityMessage(msg: UnityInbound) {
    // No-op — logging is handled by postToCanvas.
    void msg;
  }

  function handleUnityOutbound(msg: UnityOutbound) {
    pushLog({ direction: "out", event: msg.event, payload: msg.payload, ts: Date.now() });
  }

  function fireRoundResult(result: "GOAL" | "SAVE" | "DRAW") {
    const lanes = ["LEFT", "CENTER", "RIGHT"] as const;
    const kickerLane = lanes[Math.floor(Math.random() * 3)];
    const keeperLane = lanes[Math.floor(Math.random() * 3)];
    postToCanvas({
      type: "PENALTY444_MATCH_EVENT",
      event: "round_result",
      payload: {
        kickerLane,
        keeperLane,
        result,
        scores: { player1: result === "GOAL" ? round : round - 1, player2: 0 },
        round,
        maxRounds: 5,
        phase: "NORMAL",
      },
    });
    setRound((r) => r + 1);
  }

  function fireStagingBegin() {
    postToCanvas({
      type: "PENALTY444_MATCH_EVENT",
      event: "staging_begin",
      payload: { startsAt: Date.now() },
    });
  }

  function fireReset() {
    setRound(1);
    postToCanvas({ type: "PENALTY444_MATCH_EVENT", event: "reset", payload: null });
  }

  function fireMatchEnd() {
    postToCanvas({
      type: "PENALTY444_MATCH_EVENT",
      event: "match_end",
      payload: { winnerId: "player1", isDraw: false },
    });
  }

  return (
    <div className="min-h-screen bg-[#070A0F] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-amber-300">
            Dev Only
          </span>
          <span className="rounded bg-red-900/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
            Not for users
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
          Unity Bridge Sandbox
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Tests the postMessage contract from{" "}
          <code className="text-zinc-400">docs/unity-3d-prototype-plan.md §7</code>
          {" "}— no Supabase, no socket, no auth tokens.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* Mock canvas */}
          <div className="aspect-video">
            <MockUnityCanvas
              onMessage={handleUnityMessage}
              sendToReact={handleUnityOutbound}
            />
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
              Fire events → mock canvas
            </p>
            <button
              onClick={fireStagingBegin}
              className="rounded-xl border border-cyan-800/60 bg-cyan-950/40 px-4 py-2.5 text-sm font-bold text-cyan-200 hover:bg-cyan-900/40"
            >
              staging_begin
            </button>
            <div className="grid grid-cols-3 gap-2">
              {(["GOAL", "SAVE", "DRAW"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => fireRoundResult(r)}
                  className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-3 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-800/60"
                >
                  round_result ({r})
                </button>
              ))}
            </div>
            <button
              onClick={fireMatchEnd}
              className="rounded-xl border border-violet-800/60 bg-violet-950/40 px-4 py-2.5 text-sm font-bold text-violet-200 hover:bg-violet-900/40"
            >
              match_end
            </button>
            <button
              onClick={fireReset}
              className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-4 py-2.5 text-sm font-bold text-zinc-400 hover:bg-zinc-800/60"
            >
              reset (round → 1)
            </button>
          </div>
        </div>

        {/* Event log */}
        <div className="mt-6">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
            Event log (newest first)
          </p>
          <div
            ref={logRef}
            className="h-64 overflow-y-auto rounded-xl border border-zinc-800/60 bg-black/60 p-3 font-mono text-xs"
          >
            {log.length === 0 && (
              <p className="text-zinc-600">No events yet. Fire one above.</p>
            )}
            {log.map((entry, i) => (
              <div key={i} className="mb-1 flex gap-2">
                <span className={entry.direction === "in" ? "text-cyan-500" : "text-amber-400"}>
                  {entry.direction === "in" ? "→ React→Unity" : "← Unity→React"}
                </span>
                <span className="text-zinc-300">{entry.event}</span>
                <span className="truncate text-zinc-600">
                  {JSON.stringify(entry.payload)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
