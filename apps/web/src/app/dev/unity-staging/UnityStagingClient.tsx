"use client";

/**
 * DEV-ONLY — B6C staging verification client (MOCK events only).
 *
 * Loads the hosted, immutable B6B WebGL release via the SAME-ORIGIN staging
 * rewrite and drives it with deterministic mock `PENALTY444_MATCH_EVENT`
 * messages over the documented postMessage contract. Every URL used here is a
 * same-origin relative path supplied by the server page — no origin or complete
 * URL is ever taken from the query string.
 *
 * Strictly presentation-only: NO Socket.IO, NO Supabase, NO auth/JWT, NO picks,
 * NO real rooms/matches, NO real results, NO wallet/economy. It never mounts the
 * live MatchRoomPanel and never touches MatchRenderer3D. All postMessage traffic
 * is same-origin, targeted at the iframe's own window.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

// Unity → React (the app RECEIVES these). Only ready/error are accepted.
type UnityEvent =
  | { type: "PENALTY444_UNITY_EVENT"; event: "ready"; payload: null }
  | { type: "PENALTY444_UNITY_EVENT"; event: "error"; payload: { message: string } };

type ManifestMeta = {
  releaseVersion: string;
  unityVersion: string;
  sourceCommit: string;
  buildTarget: string;
  fileCount: number;
  compressionMode: string;
};

type LogEntry = {
  direction: "in" | "out";
  event: string;
  payload: unknown;
  ts: number;
};

const CONSTRAINTS = [
  "Staging only",
  "Mock events only",
  "Not a live match",
  "No Socket.IO",
  "No Supabase",
  "No auth tokens",
  "No wallet/economy",
  "No gameplay authority",
];

const COMMIT_RE = /^[0-9a-f]{40}$/;

export default function UnityStagingClient({
  version,
  indexUrl,
  manifestUrl,
}: {
  version: string;
  indexUrl: string;
  manifestUrl: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [manifest, setManifest] = useState<ManifestMeta | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<"checking" | "ok" | "missing">(
    "checking"
  );
  const [unityReady, setUnityReady] = useState(false);
  const [unityError, setUnityError] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [log, setLog] = useState<LogEntry[]>([]);

  const pushLog = useCallback((entry: LogEntry) => {
    setLog((prev) => [entry, ...prev].slice(0, 60));
  }, []);

  // 1) Fetch + validate the manifest for this version (same-origin relative URL).
  useEffect(() => {
    let cancelled = false;
    fetch(manifestUrl, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        const data: unknown = await res.json();
        const m = data as Record<string, unknown>;
        if (Number(m.schemaVersion) !== 1) throw new Error("schemaVersion is not 1");
        if (m.game !== "penalty444") throw new Error("game is not penalty444");
        if (m.releaseVersion !== version)
          throw new Error("releaseVersion does not match the requested version");
        if (m.buildTarget !== "WebGL") throw new Error("buildTarget is not WebGL");
        if (typeof m.sourceCommit !== "string" || !COMMIT_RE.test(m.sourceCommit))
          throw new Error("sourceCommit shape invalid");
        if (typeof m.unityVersion !== "string" || m.unityVersion.trim() === "")
          throw new Error("unityVersion is empty");
        if (!Array.isArray(m.files) || m.files.length === 0)
          throw new Error("files[] is empty");
        if (cancelled) return;
        setManifest({
          releaseVersion: String(m.releaseVersion),
          unityVersion: String(m.unityVersion),
          sourceCommit: String(m.sourceCommit),
          buildTarget: String(m.buildTarget),
          fileCount: Number(m.fileCount ?? m.files.length),
          compressionMode: String(m.compressionMode ?? "unknown"),
        });
        setManifestError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setManifestError(err instanceof Error ? err.message : "manifest fetch failed");
      });
    return () => {
      cancelled = true;
    };
  }, [manifestUrl, version]);

  // 2) Confirm index.html is reachable (same-origin relative URL).
  useEffect(() => {
    let cancelled = false;
    fetch(indexUrl, { method: "GET", cache: "no-store" })
      .then((res) => {
        if (!cancelled) setIndexStatus(res.ok ? "ok" : "missing");
      })
      .catch(() => {
        if (!cancelled) setIndexStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [indexUrl]);

  // 3) Strict inbound listener — same-origin + this iframe only; ready/error only.
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
        pushLog({ direction: "in", event: "error", payload: data.payload, ts: Date.now() });
      } else if (process.env.NODE_ENV !== "production") {
        console.debug("[unity-staging] ignored inbound event", data);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pushLog]);

  // 4) Send a mock event to the Unity iframe — same-origin target only.
  const send = useCallback(
    (message: MatchEvent) => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage(message, window.location.origin);
      pushLog({ direction: "out", event: message.event, payload: message.payload, ts: Date.now() });
    },
    [pushLog]
  );

  const fireStagingBegin = useCallback(() => {
    send({ type: "PENALTY444_MATCH_EVENT", event: "staging_begin", payload: { startsAt: Date.now() } });
  }, [send]);

  const fireRoundResult = useCallback(
    (kickerLane: Lane, keeperLane: Lane, result: VisualResult) => {
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
    },
    [round, send]
  );

  const fireMatchEnd = useCallback(
    (winnerId: string | null, isDraw: boolean) => {
      send({ type: "PENALTY444_MATCH_EVENT", event: "match_end", payload: { winnerId, isDraw } });
    },
    [send]
  );

  const fireReset = useCallback(() => {
    setRound(1);
    send({ type: "PENALTY444_MATCH_EVENT", event: "reset", payload: null });
  }, [send]);

  const controlsDisabled = indexStatus !== "ok" || !unityReady;

  const metaRows = useMemo(
    () =>
      manifest
        ? [
            ["release", manifest.releaseVersion],
            ["unity", manifest.unityVersion],
            ["target", manifest.buildTarget],
            ["commit", manifest.sourceCommit],
            ["files", String(manifest.fileCount)],
            ["compression", manifest.compressionMode],
          ]
        : [],
    [manifest]
  );

  return (
    <div className="min-h-screen bg-[#070A0F] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">
        {/* Banner */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-amber-300">
            Staging only
          </span>
          <span className="rounded bg-cyan-900/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300">
            Mock events
          </span>
          <span className="rounded bg-red-900/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
            Not a live match
          </span>
        </div>

        <h1 className="text-2xl font-black tracking-tight text-white">
          Unity WebGL staging verification
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Loads the hosted immutable release{" "}
          <code className="text-zinc-400">{version}</code> through the same-origin
          rewrite{" "}
          <code className="text-zinc-400">/unity/penalty444/staging/…</code> and
          drives it with deterministic mock{" "}
          <code className="text-zinc-400">PENALTY444_MATCH_EVENT</code> messages.
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
          {/* Unity iframe / status */}
          <div className="aspect-video">
            {indexStatus === "checking" ? (
              <div className="flex h-full w-full items-center justify-center rounded-xl border border-zinc-800/60 bg-black/60">
                <p className="font-mono text-sm text-zinc-500">Checking hosted release…</p>
              </div>
            ) : indexStatus === "missing" ? (
              <div className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-amber-700/60 bg-amber-950/20 p-6">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">
                    Hosted release not reachable
                  </p>
                  <p className="mt-3 text-sm text-zinc-300">
                    The same-origin staging path returned non-OK. Confirm the
                    release was deployed and{" "}
                    <code className="text-zinc-100">UNITY_STAGING_ARTIFACT_ORIGIN</code>{" "}
                    points at the correct immutable preview deployment.
                  </p>
                </div>
              </div>
            ) : (
              <div className="relative h-full w-full">
                <iframe
                  ref={iframeRef}
                  title={`Penalty444 Unity WebGL staging (${version})`}
                  src={indexUrl}
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

          {/* Controls + status */}
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
                {indexStatus !== "ok" ? "no release" : unityReady ? "Unity ready" : "waiting…"}
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

            <div className="grid grid-cols-2 gap-2">
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
                onClick={fireReset}
                disabled={controlsDisabled}
                className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-4 py-2.5 text-sm font-bold text-zinc-400 hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                reset (round → 1)
              </button>
            </div>

            <p className="text-[10px] text-zinc-600">
              Visual round counter: <span className="text-zinc-400">{round}</span>{" "}
              (mock display only — not authoritative).
            </p>

            {/* Manifest metadata */}
            <div className="mt-2 rounded-xl border border-zinc-800/60 bg-black/40 p-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
                Manifest
              </p>
              {manifestError ? (
                <p className="text-xs text-red-300">manifest invalid: {manifestError}</p>
              ) : manifest ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                  {metaRows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-zinc-600">{k}</dt>
                      <dd className="truncate text-zinc-300">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-zinc-600">Loading manifest…</p>
              )}
              <p className="mt-2 text-[10px] text-zinc-600">
                index.html:{" "}
                <span
                  className={
                    indexStatus === "ok"
                      ? "text-emerald-400"
                      : indexStatus === "missing"
                        ? "text-red-400"
                        : "text-zinc-500"
                  }
                >
                  {indexStatus}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Event log */}
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
                <span className={entry.direction === "out" ? "text-cyan-500" : "text-amber-400"}>
                  {entry.direction === "out" ? "→ React→Unity" : "← Unity→React"}
                </span>
                <span className="text-zinc-300">{entry.event}</span>
                <span className="truncate text-zinc-600">{JSON.stringify(entry.payload)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
