"use client";

/**
 * DEV-ONLY — B6C/B6D2B staging verification client (MOCK events only).
 *
 * Loads the hosted, immutable B6B WebGL release via the SAME-ORIGIN staging
 * rewrite and drives it with deterministic mock messages:
 *
 *   - LEGACY smoke controls send legacy `PENALTY444_MATCH_EVENT` envelopes
 *     (no protocolVersion): staging_begin / round_result / reset.
 *   - The B6D2B "Run Protocol v1 Proof" runs a deterministic versioned
 *     Protocol v1 sequence and verifies Unity's sanitized applied/rejected
 *     acknowledgements, instance/sequence protection, reload bootstrap, and
 *     result/state separation.
 *
 * Strictly presentation-only: NO Socket.IO, NO Supabase, NO auth/JWT, NO picks,
 * NO real rooms/matches, NO real results, NO wallet/economy. It never mounts the
 * live MatchRoomPanel and never touches MatchRenderer3D. All postMessage traffic
 * is same-origin, targeted at the iframe's own window. Inbound acks are strictly
 * validated + normalized (see unityStagingProtocol.ts); raw inbound objects are
 * never stored or displayed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  validateUnityAck,
  buildProtocolV1ProofPlan,
  type NormalizedUnityAck,
  type NormalizedAppliedAck,
  type NormalizedRejectedAck,
  type OutboundEnvelope,
  type ProofStep,
} from "./unityStagingProtocol";

type Lane = "LEFT" | "CENTER" | "RIGHT";
type VisualResult = "GOAL" | "SAVE" | "DRAW";

// LEGACY React → Unity envelopes (no protocolVersion; existing B5/B6C path).
type LegacyMatchEvent =
  | { type: "PENALTY444_MATCH_EVENT"; event: "staging_begin"; payload: { startsAt: number } }
  | {
      type: "PENALTY444_MATCH_EVENT";
      event: "round_result";
      payload: {
        kickerLane: Lane;
        keeperLane: Lane;
        result: VisualResult;
        scores: Record<string, number>;
        round: number;
        maxRounds: number;
        phase: "NORMAL" | "SUDDEN_DEATH";
      };
    }
  | { type: "PENALTY444_MATCH_EVENT"; event: "reset"; payload: null };

type ManifestMeta = {
  releaseVersion: string;
  unityVersion: string;
  sourceCommit: string;
  buildTarget: string;
  fileCount: number;
  compressionMode: string;
};

// Sanitized evidence row — derived ONLY from normalized data (never raw JSON,
// never a player-id key).
type EvidenceRow = {
  direction: "in" | "out";
  event: string;
  protocolVersion: number | "—";
  matchInstanceId: string;
  sequence: number | "—";
  appliedOrRejectedEvent: string;
  resultOrPhase: string;
  scoreValues: string;
  reason: string;
  ts: number;
};

type ProofResult = {
  id: number;
  label: string;
  status: "pass" | "fail" | "pending";
  detail: string;
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
const ACK_TIMEOUT_MS = 6000;
const READY_TIMEOUT_MS = 20000;

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
  const [indexStatus, setIndexStatus] = useState<"checking" | "ok" | "missing">("checking");
  const [unityReady, setUnityReady] = useState(false);
  const [unityError, setUnityError] = useState<string | null>(null);
  const [legacyRound, setLegacyRound] = useState(1);
  const [iframeKey, setIframeKey] = useState(0);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [proofRunning, setProofRunning] = useState(false);
  const [proofResults, setProofResults] = useState<ProofResult[]>([]);

  // Async awaiters resolved by the strict inbound listener.
  const ackWaiterRef = useRef<((ack: NormalizedUnityAck) => void) | null>(null);
  const readyWaiterRef = useRef<(() => void) | null>(null);
  const unityReadyRef = useRef(false);

  const pushEvidence = useCallback((row: EvidenceRow) => {
    setEvidence((prev) => [row, ...prev].slice(0, 120));
  }, []);

  // ── 1) Manifest fetch + validation (same-origin relative URL) ──────────────
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

  // ── 2) Confirm index.html reachable (same-origin relative URL) ─────────────
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

  // ── 3) Strict inbound listener — same-origin + this iframe only ────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: unknown; event?: unknown } | undefined;
      if (!data || data.type !== "PENALTY444_UNITY_EVENT") return;

      // Lifecycle events keep their existing strict handling.
      if (data.event === "ready") {
        setUnityReady(true);
        unityReadyRef.current = true;
        setUnityError(null);
        pushEvidence(makeRow("in", "ready"));
        const waiter = readyWaiterRef.current;
        readyWaiterRef.current = null;
        if (waiter) waiter();
        return;
      }
      if (data.event === "error") {
        const rawMsg = (data as { payload?: { message?: unknown } }).payload?.message;
        const message =
          typeof rawMsg === "string" && rawMsg.trim() !== ""
            ? rawMsg.slice(0, 300)
            : "Unknown Unity error";
        setUnityError(message);
        pushEvidence({ ...makeRow("in", "error"), reason: message });
        return;
      }

      // B6D2B versioned acknowledgements — strictly validated + normalized.
      const ack = validateUnityAck(data);
      if (ack === null) return;
      pushEvidence(evidenceFromAck(ack));
      const waiter = ackWaiterRef.current;
      ackWaiterRef.current = null;
      if (waiter) waiter(ack);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pushEvidence]);

  // ── Send helpers (same-origin target only) ─────────────────────────────────
  const post = useCallback((message: LegacyMatchEvent | OutboundEnvelope) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(message, window.location.origin);
  }, []);

  const sendLegacy = useCallback(
    (message: LegacyMatchEvent) => {
      post(message);
      pushEvidence({ ...makeRow("out", message.event), appliedOrRejectedEvent: "legacy" });
    },
    [post, pushEvidence],
  );

  const fireStagingBegin = useCallback(() => {
    sendLegacy({ type: "PENALTY444_MATCH_EVENT", event: "staging_begin", payload: { startsAt: Date.now() } });
  }, [sendLegacy]);

  const fireLegacyRoundResult = useCallback(
    (kickerLane: Lane, keeperLane: Lane, result: VisualResult) => {
      const goalsSoFar = result === "GOAL" ? legacyRound : legacyRound - 1;
      sendLegacy({
        type: "PENALTY444_MATCH_EVENT",
        event: "round_result",
        payload: {
          kickerLane,
          keeperLane,
          result,
          scores: { player1: goalsSoFar, player2: 0 },
          round: legacyRound,
          maxRounds: 5,
          phase: "NORMAL",
        },
      });
      setLegacyRound((r) => r + 1);
    },
    [legacyRound, sendLegacy],
  );

  const fireReset = useCallback(() => {
    setLegacyRound(1);
    sendLegacy({ type: "PENALTY444_MATCH_EVENT", event: "reset", payload: null });
  }, [sendLegacy]);

  // ── Proof runner primitives ────────────────────────────────────────────────
  const waitForReady = useCallback((freshRequired: boolean) => {
    return new Promise<boolean>((resolve) => {
      if (!freshRequired && unityReadyRef.current) {
        resolve(true);
        return;
      }
      const timer = window.setTimeout(() => {
        readyWaiterRef.current = null;
        resolve(false);
      }, READY_TIMEOUT_MS);
      readyWaiterRef.current = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
    });
  }, []);

  const sendAndAwaitAck = useCallback(
    (envelope: OutboundEnvelope) => {
      return new Promise<NormalizedUnityAck | null>((resolve) => {
        const timer = window.setTimeout(() => {
          ackWaiterRef.current = null;
          resolve(null);
        }, ACK_TIMEOUT_MS);
        ackWaiterRef.current = (ack) => {
          window.clearTimeout(timer);
          resolve(ack);
        };
        post(envelope);
        pushEvidence(evidenceFromOutbound(envelope));
      });
    },
    [post, pushEvidence],
  );

  const reloadIframe = useCallback(() => {
    setUnityReady(false);
    unityReadyRef.current = false;
    setIframeKey((k) => k + 1);
  }, []);

  const runProof = useCallback(async () => {
    setProofRunning(true);
    setProofResults([]);
    const plan = buildProtocolV1ProofPlan();
    const results: ProofResult[] = [];
    const record = (step: ProofStep, ok: boolean, detail: string) => {
      results.push({ id: step.id, label: step.label, status: ok ? "pass" : "fail", detail });
      setProofResults([...results]);
    };

    try {
      for (const step of plan) {
        if (step.action === "await-ready") {
          const ready = await waitForReady(false);
          record(step, ready, ready ? "Unity ready" : "timed out waiting for ready");
          if (!ready) break;
          continue;
        }
        if (step.action === "reload") {
          reloadIframe();
          const ready = await waitForReady(true);
          record(step, ready, ready ? "fresh ready after reload" : "no ready after reload");
          if (!ready) break;
          continue;
        }
        // send
        if (!step.outbound) {
          record(step, false, "no outbound envelope");
          continue;
        }
        const ack = await sendAndAwaitAck(step.outbound);
        const { ok, detail } = matchExpectation(step, ack);
        record(step, ok, detail);
      }
    } finally {
      setProofRunning(false);
    }
  }, [reloadIframe, sendAndAwaitAck, waitForReady]);

  const manifestOk = manifest !== null && manifestError === null;
  const canLoadUnity = manifestOk && indexStatus === "ok";
  const controlsDisabled = !canLoadUnity || !unityReady || unityError !== null || proofRunning;

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
    [manifest],
  );

  const proofSummary = useMemo(() => {
    const total = proofResults.length;
    const passed = proofResults.filter((r) => r.status === "pass").length;
    return { total, passed };
  }, [proofResults]);

  return (
    <div className="min-h-screen bg-[#070A0F] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-6xl">
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
          rewrite and drives it with deterministic mock messages. Protocol v1
          acknowledgements are strictly validated; player IDs and raw JSON are
          never displayed.
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
            {manifestError ? (
              <div className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-red-700/60 bg-red-950/20 p-6">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-red-300">
                    Manifest verification failed
                  </p>
                  <p className="mt-3 text-sm text-zinc-300">
                    Unity was not loaded because the release manifest did not
                    validate: <span className="text-red-300">{manifestError}</span>.
                    Confirm the deployed release version matches{" "}
                    <code className="text-zinc-100">{version}</code>.
                  </p>
                </div>
              </div>
            ) : !manifestOk || indexStatus === "checking" ? (
              <div className="flex h-full w-full items-center justify-center rounded-xl border border-zinc-800/60 bg-black/60">
                <p className="font-mono text-sm text-zinc-500">
                  {manifestOk ? "Checking hosted release…" : "Validating manifest…"}
                </p>
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
                  key={iframeKey}
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
                Protocol v1 proof
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
              onClick={runProof}
              disabled={controlsDisabled}
              className="rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-4 py-3 text-sm font-black uppercase tracking-wider text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {proofRunning ? "Running Protocol v1 proof…" : "Run Protocol v1 Proof"}
            </button>

            {proofResults.length > 0 && (
              <div className="rounded-xl border border-zinc-800/60 bg-black/40 p-3">
                <p className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
                  <span>Proof steps</span>
                  <span className="text-zinc-400">
                    {proofSummary.passed}/{proofSummary.total} passed
                  </span>
                </p>
                <ol className="space-y-1 font-mono text-[11px]">
                  {proofResults.map((r) => (
                    <li key={r.id} className="flex gap-2">
                      <span
                        className={
                          r.status === "pass"
                            ? "text-emerald-400"
                            : r.status === "fail"
                              ? "text-red-400"
                              : "text-zinc-500"
                        }
                      >
                        {r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "…"}
                      </span>
                      <span className="text-zinc-500">{r.id}.</span>
                      <span className="text-zinc-300">{r.label}</span>
                      {r.detail && <span className="text-zinc-600">— {r.detail}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Legacy smoke controls */}
            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
              Legacy smoke (no protocolVersion)
            </p>
            <button
              onClick={fireStagingBegin}
              disabled={controlsDisabled}
              className="rounded-xl border border-cyan-800/60 bg-cyan-950/40 px-4 py-2 text-sm font-bold text-cyan-200 hover:bg-cyan-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              staging_begin
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => fireLegacyRoundResult("LEFT", "RIGHT", "GOAL")}
                disabled={controlsDisabled}
                className="rounded-xl border border-emerald-800/50 bg-emerald-950/40 px-3 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                legacy round_result (GOAL)
              </button>
              <button
                onClick={fireReset}
                disabled={controlsDisabled}
                className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-3 py-2 text-sm font-bold text-zinc-400 hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                legacy reset
              </button>
            </div>

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

        {/* Sanitized evidence table */}
        <div className="mt-6">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
            Sanitized evidence (newest first — no player IDs, no raw JSON)
          </p>
          <div className="max-h-80 overflow-auto rounded-xl border border-zinc-800/60 bg-black/60">
            <table className="w-full min-w-[880px] border-collapse font-mono text-[11px]">
              <thead className="sticky top-0 bg-zinc-950/90 text-zinc-500">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-semibold">dir</th>
                  <th className="px-2 py-1.5 font-semibold">event</th>
                  <th className="px-2 py-1.5 font-semibold">pv</th>
                  <th className="px-2 py-1.5 font-semibold">matchInstanceId</th>
                  <th className="px-2 py-1.5 font-semibold">seq</th>
                  <th className="px-2 py-1.5 font-semibold">applied/rejected</th>
                  <th className="px-2 py-1.5 font-semibold">result/phase</th>
                  <th className="px-2 py-1.5 font-semibold">scoreValues</th>
                  <th className="px-2 py-1.5 font-semibold">reason</th>
                  <th className="px-2 py-1.5 font-semibold">time</th>
                </tr>
              </thead>
              <tbody>
                {evidence.length === 0 && (
                  <tr>
                    <td className="px-2 py-2 text-zinc-600" colSpan={10}>
                      No events yet. Run the Protocol v1 proof or a legacy smoke event.
                    </td>
                  </tr>
                )}
                {evidence.map((row, i) => (
                  <tr key={i} className="border-t border-zinc-900/80">
                    <td className={`px-2 py-1 ${row.direction === "out" ? "text-cyan-400" : "text-amber-300"}`}>
                      {row.direction === "out" ? "→" : "←"}
                    </td>
                    <td className="px-2 py-1 text-zinc-300">{row.event}</td>
                    <td className="px-2 py-1 text-zinc-500">{row.protocolVersion}</td>
                    <td className="px-2 py-1 text-zinc-400">{row.matchInstanceId}</td>
                    <td className="px-2 py-1 text-zinc-400">{row.sequence}</td>
                    <td className="px-2 py-1 text-zinc-400">{row.appliedOrRejectedEvent}</td>
                    <td className="px-2 py-1 text-zinc-400">{row.resultOrPhase}</td>
                    <td className="px-2 py-1 text-zinc-400">{row.scoreValues}</td>
                    <td className="px-2 py-1 text-zinc-400">{row.reason}</td>
                    <td className="px-2 py-1 text-zinc-600">
                      {new Date(row.ts).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Evidence helpers (sanitized; never store raw inbound objects) ─────────────
function makeRow(direction: "in" | "out", event: string): EvidenceRow {
  return {
    direction,
    event,
    protocolVersion: "—",
    matchInstanceId: "—",
    sequence: "—",
    appliedOrRejectedEvent: "—",
    resultOrPhase: "—",
    scoreValues: "—",
    reason: "—",
    ts: Date.now(),
  };
}

function evidenceFromOutbound(envelope: OutboundEnvelope): EvidenceRow {
  const row = makeRow("out", envelope.event);
  row.protocolVersion = envelope.protocolVersion;
  row.matchInstanceId = envelope.matchInstanceId;
  row.sequence = envelope.sequence;
  row.appliedOrRejectedEvent = envelope.event;
  if (envelope.event === "round_result") {
    row.resultOrPhase = envelope.payload.result;
  } else {
    row.resultOrPhase = envelope.payload.phase;
    row.scoreValues = `[${Object.values(envelope.payload.scores).join(", ")}]`;
  }
  return row;
}

function evidenceFromAck(ack: NormalizedUnityAck): EvidenceRow {
  const row = makeRow("in", ack.event);
  row.protocolVersion = ack.protocolVersion;
  if (ack.event === "presentation_applied") {
    const a = ack as NormalizedAppliedAck;
    row.matchInstanceId = a.matchInstanceId;
    row.sequence = a.sequence;
    row.appliedOrRejectedEvent = a.appliedEvent;
    row.resultOrPhase = a.appliedEvent === "round_result" ? a.result ?? "—" : a.phase ?? "—";
    row.scoreValues = a.scoreValues ? `[${a.scoreValues.join(", ")}]` : "—";
  } else {
    const r = ack as NormalizedRejectedAck;
    row.matchInstanceId = r.matchInstanceId ?? "—";
    row.sequence = r.sequence ?? "—";
    row.appliedOrRejectedEvent = r.rejectedEvent ?? "—";
    row.reason = r.reason;
  }
  return row;
}

// ── Proof expectation matcher ─────────────────────────────────────────────────
function matchExpectation(
  step: ProofStep,
  ack: NormalizedUnityAck | null,
): { ok: boolean; detail: string } {
  const expect = step.expect;
  if (expect.kind === "ready") {
    return { ok: false, detail: "unexpected ready expectation on a send step" };
  }
  if (ack === null) {
    return { ok: false, detail: "timed out waiting for acknowledgement" };
  }

  if (expect.kind === "applied") {
    if (ack.event !== "presentation_applied") {
      return { ok: false, detail: `expected applied, got ${ack.event}` };
    }
    const a = ack as NormalizedAppliedAck;
    if (a.appliedEvent !== expect.appliedEvent)
      return { ok: false, detail: `appliedEvent ${a.appliedEvent} != ${expect.appliedEvent}` };
    if (a.sequence !== expect.sequence)
      return { ok: false, detail: `sequence ${a.sequence} != ${expect.sequence}` };
    if (a.matchInstanceId !== expect.matchInstanceId)
      return { ok: false, detail: `instance ${a.matchInstanceId} != ${expect.matchInstanceId}` };
    if (expect.result !== undefined && a.result !== expect.result)
      return { ok: false, detail: `result ${a.result} != ${expect.result}` };
    if (expect.phase !== undefined && a.phase !== expect.phase)
      return { ok: false, detail: `phase ${a.phase} != ${expect.phase}` };
    if (expect.scoreValues !== undefined) {
      const got = JSON.stringify(a.scoreValues ?? []);
      const want = JSON.stringify(expect.scoreValues);
      if (got !== want) return { ok: false, detail: `scoreValues ${got} != ${want}` };
    }
    return { ok: true, detail: "applied as expected" };
  }

  // rejected
  if (ack.event !== "presentation_rejected") {
    return { ok: false, detail: `expected rejected, got ${ack.event}` };
  }
  const r = ack as NormalizedRejectedAck;
  if (r.reason !== expect.reason)
    return { ok: false, detail: `reason ${r.reason} != ${expect.reason}` };
  if (expect.sequence !== undefined && r.sequence !== expect.sequence)
    return { ok: false, detail: `sequence ${r.sequence} != ${expect.sequence}` };
  return { ok: true, detail: `rejected: ${r.reason}` };
}
