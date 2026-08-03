"use client";

/**
 * B6D3C — protected-preview MOCK proof harness (client).
 *
 * Drives the ALREADY-MERGED player-facing path end to end with DETERMINISTIC
 * SYNTHETIC MOCK DATA and records SANITIZED evidence only.
 *
 * What this harness reuses UNCHANGED (it re-implements none of it):
 *   - `useUnityPlayerFacingGate`  — the PR-2 cohort gate, calling the PR-1 routes.
 *   - `UnityPresentationHost`     — the PR-2 host, which mounts MatchRenderer3D.
 *   - the viewer-presentation adapter, via the pure `projectProofFeed`.
 *   - the compiled Unity Protocol v1 consumer inside the protected build.
 *
 * What this harness is NOT:
 *   - It never imports or renders MatchRoomPanel.
 *   - It never opens a Socket.IO connection and never imports a socket client.
 *   - It never reads a room, opponent, wallet, balance, payout or match result.
 *   - It never renders a pick, matchmaking, room-join or wallet control.
 *   - It carries no gameplay authority of any kind.
 *
 * Isolation invariants enforced at runtime:
 *   - AT MOST ONE Unity iframe may exist inside this harness at any moment; a
 *     MutationObserver records the maximum and any excess fails the proof.
 *   - Every DOM query is scoped to this harness's own container element.
 *   - The acknowledgement listener accepts a message ONLY when
 *     `event.origin === window.location.origin` AND `event.source` is exactly the
 *     one proof iframe's `contentWindow`.
 *   - Direct negative injections target that iframe's `contentWindow` and always
 *     pass `window.location.origin` as the target origin — never `"*"`.
 *   - Every observed request is reduced to a bounded CATEGORY; URLs, query
 *     strings, headers, cookies and tokens are never read, stored or rendered.
 *
 * Nothing runs on mount. The proof executes only when an operator presses the
 * single run control, and only when every public flag, the required build URL and
 * the server-side cohort gate already allow it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import UnityPresentationHost from "../../../components/match/UnityPresentationHost";
import { useUnityPlayerFacingGate } from "../../../components/match/useUnityPlayerFacingGate";
import type { PresentationEnvelope } from "../../../components/match/unityPresentationProtocol";
import type { ViewerIdentityContext } from "../../../components/match/unityPresentationIdentity";
import type { ViewerPresentationMessage } from "../../../components/match/useViewerPresentation";
import {
  PROOF_STEPS,
  PROOF_INSTANCE_A,
  PROOF_INSTANCE_B,
  PROOF_FOREIGN_INSTANCE,
  PROOF_BASELINE_SHA,
  PROOF_ROUTE,
  REQUIRED_BUILD_URL,
  acknowledgementMatches,
  assertNoProhibitedValues,
  buildEvidenceRowFromAck,
  buildHarnessEvidenceRow,
  buildOutboundEvidenceRow,
  buildProofReport,
  buildRawHostInputs,
  buildRawStateSync,
  buildSanitizedNegativeEnvelope,
  classifyNetworkUrl,
  normalizeAcknowledgement,
  projectProofFeed,
  type NetworkCategory,
  type ProofEvidenceRow,
  type ProofReport,
  type ProofStep,
} from "./unityB6D3CProof";

// ── Bounded, harness-owned timeouts. Never derived from input. ────────────────
const TIMEOUT_MS: Record<ProofStep["timeoutLabel"], number> = {
  short: 1_500,
  standard: 6_000,
  load: 30_000,
};
const POLL_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Bounded poll. Resolves true as soon as `predicate` holds, false on timeout. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await delay(POLL_MS);
  }
}

/** The Supabase auth origin, used ONLY to classify a request. Never rendered. */
function readAuthOrigin(): string | null {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (raw.length === 0) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function isReadyEvent(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  return record.type === "PENALTY444_UNITY_EVENT" && record.event === "ready";
}

export default function UnityB6D3CProofClient() {
  // ── Public build-time flags (all four, exactly as MatchRoomPanel composes) ──
  const matchEnabled = process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true";
  const liveShadowEnabled = process.env.NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true";
  const b6d2ShadowEnabled = process.env.NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED === "true";
  const playerFacingEnabled = process.env.NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED === "true";
  // The proof is meaningful only against the PR-1 protected entry point.
  const buildUrl = (process.env.NEXT_PUBLIC_UNITY_BUILD_URL ?? "").trim();
  const buildUrlCorrect = buildUrl === REQUIRED_BUILD_URL;

  const flagsRequested =
    matchEnabled && liveShadowEnabled && b6d2ShadowEnabled && playerFacingEnabled;
  const preconditionsMet = flagsRequested && buildUrlCorrect;

  // Reused UNCHANGED from PR-2. No network happens while `requested` is false.
  const gate = useUnityPlayerFacingGate({ requested: preconditionsMet });
  const authorized = gate === "authorized";

  // ── Deterministic mock feeds (computed once; no request-derived input) ──────
  const feedA = useMemo(
    () => projectProofFeed(PROOF_INSTANCE_A, buildRawHostInputs(PROOF_INSTANCE_A)),
    [],
  );
  const feedB = useMemo(
    () => projectProofFeed(PROOF_INSTANCE_B, buildRawHostInputs(PROOF_INSTANCE_B)),
    [],
  );

  // ── Host-driven state ──────────────────────────────────────────────────────
  const [activeInstance, setActiveInstance] = useState<string | null>(PROOF_INSTANCE_A);
  const [identity, setIdentity] = useState<ViewerIdentityContext | null>(feedA.identity);
  const [hostMessages, setHostMessages] = useState<ReadonlyArray<ViewerPresentationMessage>>([]);

  // ── Evidence + observation state ───────────────────────────────────────────
  const [rows, setRows] = useState<ReadonlyArray<ProofEvidenceRow>>([]);
  const [report, setReport] = useState<ProofReport | null>(null);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [harnessError, setHarnessError] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<ProofEvidenceRow[]>([]);
  const ackLogRef = useRef<Array<ReturnType<typeof normalizeAcknowledgement>>>([]);
  const readyCountRef = useRef(0);
  const maxIframeRef = useRef(0);
  const networkRef = useRef<Set<NetworkCategory>>(new Set());
  const startedRef = useRef(false);

  const pushRow = useCallback((row: ProofEvidenceRow) => {
    rowsRef.current = [...rowsRef.current, row];
    setRows(rowsRef.current);
  }, []);

  // ── Container-scoped DOM helpers ───────────────────────────────────────────
  const iframes = useCallback((): HTMLIFrameElement[] => {
    const root = containerRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll("iframe"));
  }, []);

  /** The single proof iframe, or null when there is not exactly one. */
  const proofIframe = useCallback((): HTMLIFrameElement | null => {
    const found = iframes();
    return found.length === 1 ? found[0] : null;
  }, [iframes]);

  const readHostState = useCallback((): string | null => {
    const root = containerRef.current;
    if (!root) return null;
    const host = root.querySelector("[data-unity-host]");
    return host === null ? null : host.getAttribute("data-host-state");
  }, []);

  // ── One-iframe invariant (records the maximum ever observed) ───────────────
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const sample = () => {
      const count = root.querySelectorAll("iframe").length;
      if (count > maxIframeRef.current) maxIframeRef.current = count;
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // ── Bounded network observation: CATEGORIES ONLY ───────────────────────────
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const pageOrigin = window.location.origin;
    const authOrigin = readAuthOrigin();
    const record = (entries: ReadonlyArray<PerformanceEntry>) => {
      for (const entry of entries) {
        // `entry.name` is discarded immediately; only the category is retained.
        networkRef.current.add(classifyNetworkUrl(entry.name, pageOrigin, authOrigin));
      }
    };
    let observer: PerformanceObserver;
    try {
      observer = new PerformanceObserver((list) => record(list.getEntries()));
      observer.observe({ type: "resource", buffered: true });
    } catch {
      return;
    }
    return () => observer.disconnect();
  }, []);

  // ── Strict acknowledgement listener ────────────────────────────────────────
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Same-origin only, AND only from the ONE proof iframe.
      if (event.origin !== window.location.origin) return;
      const frame = proofIframe();
      if (frame === null || event.source !== frame.contentWindow) return;

      if (isReadyEvent(event.data)) {
        readyCountRef.current += 1;
        return;
      }
      // The raw object is never retained — only the normalized result.
      const ack = normalizeAcknowledgement(event.data);
      if (ack !== null) ackLogRef.current.push(ack);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [proofIframe]);

  // ── Step primitives ────────────────────────────────────────────────────────

  /** Wait for an acknowledgement (arriving after `from`) that satisfies `step`. */
  const awaitAck = useCallback(async (step: ProofStep, from: number): Promise<boolean> => {
    const matched = await waitUntil(() => {
      for (let i = from; i < ackLogRef.current.length; i++) {
        const ack = ackLogRef.current[i];
        if (ack !== null && acknowledgementMatches(step, ack)) return true;
      }
      return false;
    }, TIMEOUT_MS[step.timeoutLabel]);

    if (!matched) {
      // Record the first unmatched acknowledgement, if any, as bounded evidence.
      const stray = ackLogRef.current.slice(from).find((a) => a !== null);
      if (stray) {
        pushRow(buildEvidenceRowFromAck(step, stray, "fail", "unexpected_outcome"));
      } else {
        pushRow(
          buildHarnessEvidenceRow({
            step,
            status: "fail",
            hostState: readHostState(),
            iframeCount: iframes().length,
            failureCategory: "missing_acknowledgement",
          }),
        );
      }
      return false;
    }
    for (let i = from; i < ackLogRef.current.length; i++) {
      const ack = ackLogRef.current[i];
      if (ack !== null && acknowledgementMatches(step, ack)) {
        pushRow(buildEvidenceRowFromAck(step, ack, "pass"));
        return true;
      }
    }
    return false;
  }, [iframes, pushRow, readHostState]);

  /** HOST channel: publish one already-projected envelope and await its ack. */
  const sendViaHost = useCallback(
    async (step: ProofStep, item: ViewerPresentationMessage): Promise<boolean> => {
      const from = ackLogRef.current.length;
      pushRow(buildOutboundEvidenceRow(step, item.message, "pending"));
      setHostMessages((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item]));
      return awaitAck(step, from);
    },
    [awaitAck, pushRow],
  );

  /**
   * DIRECT-NEGATIVE channel: post an ALREADY-SANITIZED envelope straight to the
   * single proof iframe. Used only for duplicate / stale / foreign-instance
   * negatives, which the host path deliberately filters out before Unity and so
   * could never reach the compiled consumer through the production route.
   */
  const sendDirect = useCallback(
    async (step: ProofStep, envelope: PresentationEnvelope): Promise<boolean> => {
      const frame = proofIframe();
      const target = frame === null ? null : frame.contentWindow;
      if (target === null) {
        pushRow(
          buildHarnessEvidenceRow({
            step,
            status: "fail",
            hostState: readHostState(),
            iframeCount: iframes().length,
            failureCategory: "iframe_invariant_violation",
          }),
        );
        return false;
      }
      const from = ackLogRef.current.length;
      pushRow(buildOutboundEvidenceRow(step, envelope, "pending"));
      // Explicit target origin — never "*".
      target.postMessage(envelope, window.location.origin);
      return awaitAck(step, from);
    },
    [awaitAck, iframes, proofIframe, pushRow, readHostState],
  );

  // ── The proof run ──────────────────────────────────────────────────────────
  const runProof = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunning(true);
    setHarnessError(false);

    const step = (n: number): ProofStep => PROOF_STEPS[n - 1];
    const observe = (n: number, ok: boolean, category: ProofEvidenceRow["failureCategory"]) =>
      pushRow(
        buildHarnessEvidenceRow({
          step: step(n),
          status: ok ? "pass" : "fail",
          hostState: readHostState(),
          iframeCount: iframes().length,
          failureCategory: ok ? "none" : category,
        }),
      );

    try {
      // 1 — the single proof iframe reaches `ready`.
      setCurrentStep(1);
      const baseline = readyCountRef.current;
      const ready = await waitUntil(
        () => readyCountRef.current > baseline,
        TIMEOUT_MS[step(1).timeoutLabel],
      );
      observe(1, ready && iframes().length === 1, "timeout");
      if (!ready) throw new Error("not-ready");

      // 2 — bootstrap 0/0.
      setCurrentStep(2);
      if (!(await sendViaHost(step(2), feedA.messages[0]))) throw new Error("step-2");

      // 3 — round_result GOAL (no score).
      setCurrentStep(3);
      if (!(await sendViaHost(step(3), feedA.messages[1]))) throw new Error("step-3");

      // 4 — the authoritative state sync carries the score change.
      setCurrentStep(4);
      if (!(await sendViaHost(step(4), feedA.messages[2]))) throw new Error("step-4");

      // 5 — per-envelope snapshots: the bootstrap kept 0/0 while the later sync
      //     carried 1/0. Both acks are already recorded above; here we only
      //     confirm the host is visible with exactly one iframe.
      setCurrentStep(5);
      observe(5, readHostState() === "UNITY_READY_VISIBLE" && iframes().length === 1, "unexpected_outcome");

      // 6 — duplicate sequence 3 (distinct proof message id, same sequence).
      setCurrentStep(6);
      const duplicate = buildSanitizedNegativeEnvelope({
        matchInstanceId: PROOF_INSTANCE_A,
        sequence: 3,
        leftScore: 1,
        rightScore: 0,
        round: 2,
        maxRounds: 5,
        phase: "NORMAL",
      });
      if (duplicate === null) throw new Error("step-6-build");
      if (!(await sendDirect(step(6), duplicate))) throw new Error("step-6");

      // 7 — stale sequence 2.
      setCurrentStep(7);
      const stale = buildSanitizedNegativeEnvelope({
        matchInstanceId: PROOF_INSTANCE_A,
        sequence: 2,
        leftScore: 0,
        rightScore: 0,
        round: 1,
        maxRounds: 5,
        phase: "NORMAL",
      });
      if (stale === null) throw new Error("step-7-build");
      if (!(await sendDirect(step(7), stale))) throw new Error("step-7");

      // 8 — a foreign-instance envelope never survives the merged adapter, so it
      //     can never reach the host feed. Observed on the real adapter.
      setCurrentStep(8);
      const foreignThroughAdapter = projectProofFeed(PROOF_INSTANCE_A, [
        {
          id: `${PROOF_FOREIGN_INSTANCE}:5:match_state_sync`,
          message: buildRawStateSync({
            matchInstanceId: PROOF_FOREIGN_INSTANCE,
            sequence: 5,
            selfScore: 9,
            opponentScore: 9,
            round: 4,
            maxRounds: 5,
            phase: "NORMAL",
          }),
        },
      ]);
      observe(8, foreignThroughAdapter.messages.length === 0, "unexpected_outcome");

      // 9 — the compiled consumer rejects a DIRECT foreign-instance envelope.
      setCurrentStep(9);
      const foreign = buildSanitizedNegativeEnvelope({
        matchInstanceId: PROOF_FOREIGN_INSTANCE,
        sequence: 5,
        leftScore: 9,
        rightScore: 9,
        round: 4,
        maxRounds: 5,
        phase: "NORMAL",
      });
      if (foreign === null) throw new Error("step-9-build");
      if (!(await sendDirect(step(9), foreign))) throw new Error("step-9");

      // 10 — SUDDEN_DEATH with the supplied suddenDeathRound.
      setCurrentStep(10);
      if (!(await sendViaHost(step(10), feedA.messages[3]))) throw new Error("step-10");

      // 11 — instance transition: same room, higher instance, sequence exactly 1.
      setCurrentStep(11);
      setActiveInstance(PROOF_INSTANCE_B);
      setIdentity(feedB.identity);
      setHostMessages([]);
      await delay(POLL_MS);
      if (!(await sendViaHost(step(11), feedB.messages[0]))) throw new Error("step-11");

      // 12 — the superseded instance is still rejected afterwards.
      setCurrentStep(12);
      const superseded = buildSanitizedNegativeEnvelope({
        matchInstanceId: PROOF_INSTANCE_A,
        sequence: 9,
        leftScore: 4,
        rightScore: 4,
        round: 7,
        maxRounds: 5,
        phase: "NORMAL",
      });
      if (superseded === null) throw new Error("step-12-build");
      if (!(await sendDirect(step(12), superseded))) throw new Error("step-12");

      // 13 — reload the SINGLE proof iframe and wait for a fresh `ready`.
      setCurrentStep(13);
      const beforeReload = readyCountRef.current;
      // Clear the feed first so the post-reload bootstrap is unambiguously the
      // sequence-5 envelope and nothing is replayed.
      setHostMessages([]);
      await delay(POLL_MS);
      const frame = proofIframe();
      if (frame === null) {
        observe(13, false, "iframe_invariant_violation");
        throw new Error("step-13-iframe");
      }
      try {
        // Same-origin reload; falls back to re-assigning the same relative src.
        frame.contentWindow?.location.reload();
      } catch {
        frame.src = REQUIRED_BUILD_URL;
      }
      const reloaded = await waitUntil(
        () => readyCountRef.current > beforeReload,
        TIMEOUT_MS[step(13).timeoutLabel],
      );
      observe(13, reloaded && iframes().length === 1, "timeout");
      if (!reloaded) throw new Error("step-13");

      // 14 — a complete bootstrap at sequence 5 (> 1) is accepted after reload.
      setCurrentStep(14);
      if (!(await sendViaHost(step(14), feedB.messages[1]))) throw new Error("step-14");

      // 15 — a NATIVE iframe error is terminal for this instance: the renderer is
      //      unmounted and the React underlay is exposed with zero Unity iframes.
      setCurrentStep(15);
      const target = proofIframe();
      if (target === null) {
        observe(15, false, "iframe_invariant_violation");
        throw new Error("step-15-iframe");
      }
      target.dispatchEvent(new Event("error"));
      const failedOpen = await waitUntil(
        () => readHostState() === "UNITY_FAILED_REACT_FALLBACK" && iframes().length === 0,
        TIMEOUT_MS[step(15).timeoutLabel],
      );
      observe(15, failedOpen, "unexpected_outcome");
      if (!failedOpen) throw new Error("step-15");

      // 16 — sanitization: no synthetic raw identifier anywhere in the projected
      //      feeds or in the accumulated evidence.
      setCurrentStep(16);
      let sanitized = true;
      try {
        assertNoProhibitedValues({
          feedA: feedA.messages,
          feedB: feedB.messages,
          rows: rowsRef.current,
        });
      } catch {
        sanitized = false;
      }
      observe(16, sanitized, "sanitization_violation");
    } catch {
      // Any harness fault is recorded as a bounded category; the run then ends
      // and the report below reflects whatever evidence was collected.
      setHarnessError(true);
    } finally {
      setCurrentStep(null);
      setRunning(false);
      try {
        setReport(
          buildProofReport({
            rows: rowsRef.current,
            maxIframeCount: maxIframeRef.current,
            networkCategories: Array.from(networkRef.current).sort(),
          }),
        );
      } catch {
        // A report that would have contained something prohibited is NEVER shown.
        setReport(null);
        setHarnessError(true);
      }
    }
  }, [
    feedA,
    feedB,
    iframes,
    proofIframe,
    pushRow,
    readHostState,
    sendDirect,
    sendViaHost,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const canRun = authorized && identity !== null && !running && !startedRef.current;

  return (
    <main
      ref={containerRef}
      data-b6d3c-proof=""
      className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-4 text-zinc-200"
    >
      {/* Unmissable, always-visible mock banner. */}
      <section
        data-b6d3c-banner=""
        className="rounded-2xl border-2 border-amber-400 bg-amber-950/40 p-4"
      >
        <h1 className="text-lg font-black tracking-wide text-amber-200">
          B6D3C PROTECTED-PREVIEW MOCK PROOF
        </h1>
        <ul className="mt-2 space-y-1 text-sm font-bold text-amber-100">
          <li>MOCK EVENTS ONLY</li>
          <li>NO REAL MATCH</li>
          <li>PRODUCTION NO-GO</li>
        </ul>
        <p className="mt-2 text-xs text-amber-200/80">
          Synthetic data only. This surface has no gameplay authority: no socket, no
          room, no opponent, no wallet, no result. Baseline {PROOF_BASELINE_SHA} ·
          route {PROOF_ROUTE}.
        </p>
      </section>

      {/* Preconditions — booleans only, never a value. */}
      <section className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4 text-sm">
        <h2 className="font-bold text-zinc-100">Preconditions</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          <li>NEXT_PUBLIC_UNITY_MATCH_ENABLED: {matchEnabled ? "on" : "off"}</li>
          <li>NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED: {liveShadowEnabled ? "on" : "off"}</li>
          <li>NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED: {b6d2ShadowEnabled ? "on" : "off"}</li>
          <li>NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED: {playerFacingEnabled ? "on" : "off"}</li>
          <li>build URL is {REQUIRED_BUILD_URL}: {buildUrlCorrect ? "yes" : "no"}</li>
          <li>cohort gate: {gate}</li>
        </ul>
        {!preconditionsMet ? (
          <p className="mt-2 text-xs text-zinc-400">
            The proof cannot run until every flag is enabled and the build URL is the
            protected entry point. Nothing was requested from the network.
          </p>
        ) : null}
      </section>

      {/* Single run control. No pick, room, matchmaking or wallet control exists. */}
      <section className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void runProof()}
          disabled={!canRun}
          className="rounded-xl border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-sm font-bold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Running…" : "Run mock proof"}
        </button>
        <span className="text-xs text-zinc-400">
          {currentStep === null
            ? `${PROOF_STEPS.length} steps · ${rows.length} evidence rows`
            : `step ${currentStep} / ${PROOF_STEPS.length}`}
        </span>
      </section>

      {/* The MERGED host, unmodified. Exactly one may exist on this page. */}
      <section className="h-[360px] w-full overflow-hidden rounded-2xl border border-zinc-700">
        <UnityPresentationHost
          playerFacingAuthorized={authorized}
          matchInstanceId={activeInstance}
          messages={hostMessages}
          identity={identity}
          correlation={null}
          onReady={() => {}}
          onError={() => {}}
          onMessageSent={() => {}}
        >
          <div
            data-b6d3c-underlay=""
            className="flex h-full w-full items-center justify-center bg-zinc-950 text-xs text-zinc-500"
          >
            React underlay (decorative)
          </div>
        </UnityPresentationHost>
      </section>

      {/* Sanitized evidence. Bounded fields only — no raw JSON, no identity. */}
      <section className="overflow-x-auto rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4">
        <h2 className="font-bold text-zinc-100">Evidence</h2>
        <table className="mt-2 w-full min-w-[720px] text-left text-xs">
          <thead className="text-zinc-400">
            <tr>
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">gate</th>
              <th className="py-1 pr-2">dir</th>
              <th className="py-1 pr-2">event</th>
              <th className="py-1 pr-2">v</th>
              <th className="py-1 pr-2">instance</th>
              <th className="py-1 pr-2">seq</th>
              <th className="py-1 pr-2">applied</th>
              <th className="py-1 pr-2">result</th>
              <th className="py-1 pr-2">phase</th>
              <th className="py-1 pr-2">scores</th>
              <th className="py-1 pr-2">players</th>
              <th className="py-1 pr-2">reason</th>
              <th className="py-1 pr-2">host</th>
              <th className="py-1 pr-2">frames</th>
              <th className="py-1 pr-2">status</th>
              <th className="py-1">failure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.step}-${index}`} className="border-t border-zinc-800">
                <td className="py-1 pr-2">{row.step}</td>
                <td className="py-1 pr-2">{row.gate}</td>
                <td className="py-1 pr-2">{row.direction}</td>
                <td className="py-1 pr-2">{row.event ?? "—"}</td>
                <td className="py-1 pr-2">{row.protocolVersion ?? "—"}</td>
                <td className="py-1 pr-2">{row.matchInstanceId ?? "—"}</td>
                <td className="py-1 pr-2">{row.sequence ?? "—"}</td>
                <td className="py-1 pr-2">{row.appliedEvent ?? "—"}</td>
                <td className="py-1 pr-2">{row.result ?? "—"}</td>
                <td className="py-1 pr-2">{row.phase ?? "—"}</td>
                <td className="py-1 pr-2">
                  {row.scoreValues === null ? "—" : row.scoreValues.join("/")}
                </td>
                <td className="py-1 pr-2">{row.playerCount ?? "—"}</td>
                <td className="py-1 pr-2">{row.rejectionReason ?? "—"}</td>
                <td className="py-1 pr-2">{row.hostState ?? "—"}</td>
                <td className="py-1 pr-2">{row.iframeCount ?? "—"}</td>
                <td className="py-1 pr-2 font-bold">{row.status}</td>
                <td className="py-1">{row.failureCategory}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="py-2 text-zinc-500" colSpan={17}>
                  No evidence yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {/* Summary. */}
      <section className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4 text-sm">
        <h2 className="font-bold text-zinc-100">Summary</h2>
        {report === null ? (
          <p className="mt-2 text-zinc-400">
            {harnessError ? "Harness fault — no report was produced." : "Not run yet."}
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <p data-b6d3c-overall={report.overall} className="text-base font-black">
              OVERALL: {report.overall.toUpperCase()}
              {harnessError ? " (harness fault recorded)" : ""}
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {report.gates.map((g) => (
                <li key={g.gate}>
                  {g.gate}: <span className="font-bold">{g.status}</span>
                  {g.failureCategory === "none" ? "" : ` (${g.failureCategory})`} ·{" "}
                  {g.stepCount} step(s)
                </li>
              ))}
            </ul>
            <p>max concurrent Unity iframes: {report.maxIframeCount}</p>
            <p>
              observed request categories:{" "}
              {report.networkCategories.length === 0
                ? "none"
                : report.networkCategories.join(", ")}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
