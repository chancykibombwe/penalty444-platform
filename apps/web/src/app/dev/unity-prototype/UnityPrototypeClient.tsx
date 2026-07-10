"use client";

/**
 * DEV-ONLY — React → Unity mock event harness (Phase B4).
 *
 * Loads the local, git-ignored Unity WebGL build (/unity/penalty444/index.html)
 * in a real iframe and drives it with DETERMINISTIC MOCK presentation events
 * over the documented postMessage contract (docs/unity-webgl-prototype-plan.md
 * §3). Rendered only when the server page guard passes (non-production, or
 * UNITY_PROTOTYPE_ROUTE_ENABLED=true on the server).
 *
 * Strictly presentation-only: no live match state, no Socket.IO, no Supabase,
 * no auth tokens, no wallet/economy, no gameplay authority. React never submits
 * picks and never computes results — Unity only displays the supplied result.
 * All postMessage traffic is same-origin, targeted at the iframe's own window.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const BUILD_INDEX_URL = "/unity/penalty444/index.html";

type Lane = "LEFT" | "CENTER" | "RIGHT";
type VisualResult = "GOAL" | "SAVE" | "DRAW";

type RoundResultPayload = {
  kickerLane: Lane;
  keeperLane: Lane;
  result: VisualResult;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  phase: "NORMAL" | "SUDDEN_DEATH";
};

// React → Unity (the app SENDS these).
type MatchEvent =
  | { type: "PENALTY444_MATCH_EVENT"; event: "staging_begin"; payload: { startsAt: number } }
  | { type: "PENALTY444_MATCH_EVENT"; event: "round_result"; payload: RoundResultPayload }
  | { type: "PENALTY444_MATCH_EVENT"; event: "match_end"; payload: { winnerId: string | null; isDraw: boolean } }
  | { type: "PENALTY444_MATCH_EVENT"; event: "reset"; payload: null };

// Unity → React (the app RECEIVES these). Only "ready" is implemented in B4.
type UnityEvent =
  | { type: "PENALTY444_UNITY_EVENT"; event: "ready"; payload: null }
  | { type: "PENALTY444_UNITY_EVENT"; event: "error"; payload: { message: string } };

type LogEntry = {
  direction: "in" | "out";
  event: string;
  payload: unknown;
  ts: number;
};

const CONSTRAINTS = [
  "Dev only",
  "Mock events only",
  "No live match state",
  "No Socket.IO authority",
  "No Supabase",
  "No auth tokens",
  "No wallet/economy",
  "No gameplay authority",
];

export default function UnityPrototypeClient() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [status, setStatus] = useState<"checking" | "missing" | "present">(
    "checking"
  );
  const [unityReady, setUnityReady] = useState(false);
  const [unityError, setUnityError] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [log, setLog] = useState<LogEntry[]>([]);

  const pushLog = useCallback((entry: LogEntry) => {
    setLog((prev) => [entry, ...prev].slice(0, 60));
  }, []);

  // 1) Runtime existence check (same HEAD check as the passive viewer). Keeps
  //    the page building/rendering when the git-ignored build is absent.
  useEffect(() => {
    let cancelled = false;
    fetch(BUILD_INDEX_URL, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setStatus(res.ok ? "present" : "missing");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Strict inbound listener for Unity → React events. Every guard must pass;
  //    anything else is ignored (dev-console note only, never a user-facing error).
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as UnityEvent | undefined;
      if (!data || data.type !== "PENALTY444_UNITY_EVENT") return;

      if (data.event === "ready") {
        setUnityReady(true);
        setUnityError(null);
        pushLog({ direction: "in", event: "ready", payload: null, ts: Date.now() });
      } else if (data.event === "error") {
        setUnityError(data.payload?.message ?? "Unknown Unity error");
        pushLog({
          direction: "in",
          event: "error",
          payload: data.payload,
          ts: Date.now(),
        });
      } else if (process.env.NODE_ENV !== "production") {
        // Unapproved/unknown PENALTY444_UNITY_EVENT — log to console only.
        console.debug("[unity-harness] ignored inbound event", data);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pushLog]);

  // 3) Send a mock event to the Unity iframe — same-origin target only.
  const send = useCallback(
    (message: MatchEvent) => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage(message, window.location.origin);
      pushLog({
        direction: "out",
        event: message.event,
        payload: message.payload,
        ts: Date.now(),
      });
    },
    [pushLog]
  );

  function fireStagingBegin() {
    send({
      type: "PENALTY444_MATCH_EVENT",
      event: "staging_begin",
      payload: { startsAt: Date.now() },
    });
  }

  function fireRoundResult(kickerLane: Lane, keeperLane: Lane, result: VisualResult) {
    // Mock, display-only scores (NOT authoritative).
    const goalsSoFar = result === "GOAL" ? round : round - 1;
    send({
      type: "PENALTY444_MATCH_EVENT",
      event: "round_result",
      payload: {
        kickerLane,
        keeperLane,
        result,
        scores: { player1: goalsSoFar, player2: 0 },
        round,
        maxRounds: 5,
        phase: "NORMAL",
      },
    });
    setRound((r) => r + 1);
  }

  function fireMatchEnd(winnerId: string | null, isDraw: boolean) {
    send({
      type: "PENALTY444_MATCH_EVENT",
      event: "match_end",
      payload: { winnerId, isDraw },
    });
  }

  function fireReset() {
    setRound(1);
    send({ type: "PENALTY444_MATCH_EVENT", event: "reset", payload: null });
  }

  const controlsDisabled = status !== "present" || !unityReady;

  return (
    <div className="min-h-screen bg-[#070A0F] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-amber-300">
            Dev Only
          </span>
          <span className="rounded bg-red-900/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
            Not for users
          </span>
        </div>

        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
          React → Unity mock event harness
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Drives the local Unity WebGL build at{" "}
          <code className="text-zinc-400">/unity/penalty444/</code> with
          deterministic mock <code className="text-zinc-400">PENALTY444_MATCH_EVENT</code>{" "}
          messages over same-origin postMessage.
        </p>

        <ul className="mt-3 flex flex-wrap gap-1.5">
          {CONSTRAINTS.map((c) => (
            <li
              key={c}
              className="rounded border border-zinc-800/70 bg-zinc-900/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400"
            >
              {c}
            </li>
          ))}
        </ul>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* ── Unity iframe / status ── */}
          <div className="aspect-video">
            {status === "checking" ? (
              <div className="flex h-full w-full items-center justify-center rounded-xl border border-zinc-800/60 bg-black/60">
                <p className="font-mono text-sm text-zinc-500">
                  Checking for local build…
                </p>
              </div>
            ) : status === "missing" ? (
              <div className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-amber-700/60 bg-amber-950/20 p-6">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">
                    WebGL output not found
                  </p>
                  <p className="mt-3 text-sm text-zinc-300">
                    Unity WebGL output was not found locally. Rebuild the Unity
                    WebGL build to{" "}
                    <code className="text-zinc-100">
                      apps/web/public/unity/penalty444/
                    </code>{" "}
                    (a rebuild is required after any bridge source change), then
                    reload. See{" "}
                    <code className="text-zinc-400">
                      docs/unity-webgl-build-pipeline.md
                    </code>{" "}
                    §6.
                  </p>
                </div>
              </div>
            ) : (
              <div className="relative h-full w-full">
                <iframe
                  ref={iframeRef}
                  title="Penalty444 Unity WebGL build (dev harness)"
                  src={BUILD_INDEX_URL}
                  className="h-full w-full rounded-xl border border-zinc-800/60 bg-black"
                />
                {!unityReady && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                    <p className="font-mono text-sm text-cyan-300">
                      Loading Unity… (waiting for “ready”)
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Mock event controls ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
                Fire mock events → Unity
              </p>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  unityReady
                    ? "bg-emerald-900/50 text-emerald-300"
                    : "bg-zinc-800/60 text-zinc-500"
                }`}
              >
                {status !== "present"
                  ? "no build"
                  : unityReady
                    ? "Unity ready"
                    : "waiting…"}
              </span>
            </div>

            {unityError && (
              <p className="rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                Unity error: {unityError}
              </p>
            )}

            <button
              onClick={fireStagingBegin}
              disabled={controlsDisabled}
              className="rounded-xl border border-cyan-800/60 bg-cyan-950/40 px-4 py-2.5 text-sm font-bold text-cyan-200 hover:bg-cyan-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              staging_begin
            </button>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => fireRoundResult("LEFT", "RIGHT", "GOAL")}
                disabled={controlsDisabled}
                className="rounded-xl border border-emerald-800/50 bg-emerald-950/40 px-3 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                round_result (GOAL)
              </button>
              <button
                onClick={() => fireRoundResult("CENTER", "CENTER", "SAVE")}
                disabled={controlsDisabled}
                className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-3 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                round_result (SAVE)
              </button>
              <button
                onClick={() => fireRoundResult("CENTER", "CENTER", "DRAW")}
                disabled={controlsDisabled}
                className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-3 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                round_result (DRAW)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => fireMatchEnd("player1", false)}
                disabled={controlsDisabled}
                className="rounded-xl border border-violet-800/60 bg-violet-950/40 px-4 py-2.5 text-sm font-bold text-violet-200 hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                match_end (winner)
              </button>
              <button
                onClick={() => fireMatchEnd(null, true)}
                disabled={controlsDisabled}
                className="rounded-xl border border-violet-800/60 bg-violet-950/40 px-4 py-2.5 text-sm font-bold text-violet-200 hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                match_end (draw)
              </button>
            </div>

            <button
              onClick={fireReset}
              disabled={controlsDisabled}
              className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-4 py-2.5 text-sm font-bold text-zinc-400 hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              reset (round → 1)
            </button>

            <p className="text-[10px] text-zinc-600">
              Visual round counter: <span className="text-zinc-400">{round}</span>{" "}
              (mock display only — not authoritative).
            </p>
          </div>
        </div>

        {/* ── Event log ── */}
        <div className="mt-6">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
            Event log (newest first)
          </p>
          <div className="h-64 overflow-y-auto rounded-xl border border-zinc-800/60 bg-black/60 p-3 font-mono text-xs">
            {log.length === 0 && (
              <p className="text-zinc-600">No events yet. Fire one above.</p>
            )}
            {log.map((entry, i) => (
              <div key={i} className="mb-1 flex gap-2">
                <span className="shrink-0 text-zinc-600">
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
                <span
                  className={
                    entry.direction === "out" ? "text-cyan-500" : "text-amber-400"
                  }
                >
                  {entry.direction === "out" ? "→ React→Unity" : "← Unity→React"}
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
