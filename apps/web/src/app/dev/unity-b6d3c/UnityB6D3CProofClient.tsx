"use client";

/**
 * B6D3C — protected-preview MOCK proof harness (client).
 *
 * Drives the ALREADY-MERGED player-facing path end to end with DETERMINISTIC
 * SYNTHETIC MOCK DATA and records SANITIZED evidence only.
 *
 * OPERATOR-INITIATED CONTRACT (exact wording — nothing weaker):
 *   Neither a cohort request NOR the Unity renderer begins before the operator
 *   presses Run. On mount the harness holds `operatorRequested = false`, so the
 *   merged cohort hook is called with `requested: false` and performs no Supabase
 *   read and no fetch; and it holds `proofActivated = false`, so the host is
 *   passed `playerFacingAuthorized: false` and mounts ZERO Unity iframes. A gate
 *   that resolves `authorized` is NOT sufficient to mount anything — activation
 *   also requires the operator's press and the explicit activation step.
 *   A `denied` gate leaves the surface React-only and never starts the proof.
 *
 * What this harness reuses UNCHANGED (it re-implements none of it):
 *   - `useUnityPlayerFacingGate`  — the PR-2 cohort gate, calling the PR-1 routes.
 *   - `UnityPresentationHost`     — the PR-2 host, which mounts MatchRenderer3D,
 *                                   including its `onMessageSent` send confirmation.
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
 *   - Network observation starts WHEN THE OPERATOR STARTS THE RUN and ignores any
 *     buffered entry from before that instant, so pre-run Preview traffic is never
 *     collected and never counted as isolation.
 *   - Every observed request is reduced to a bounded CATEGORY; URLs, query
 *     strings, headers, cookies and tokens are never read, stored or rendered.
 *
 * Evidence lifecycle: an outbound row is RETAINED only after the dispatch has
 * been confirmed (the merged host's `onMessageSent` summary for a host dispatch)
 * and the expected acknowledgement has arrived. A transient pending indicator may
 * appear in the UI, but no `pending` row ever reaches the evidence collection or
 * the report.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import UnityPresentationHost from "../../../components/match/UnityPresentationHost";
import {
  useUnityPlayerFacingGate,
  type UnityPlayerFacingGateDiagnostic,
} from "../../../components/match/useUnityPlayerFacingGate";
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
  buildFallbackEvidenceRow,
  buildHarnessEvidenceRow,
  buildOutboundEvidenceRow,
  buildProofReport,
  buildRawHostInputs,
  buildRawStateSync,
  buildSanitizedNegativeEnvelope,
  buildSnapshotEvidenceRows,
  classifyNetworkUrl,
  entryIsInsideProofWindow,
  fallbackObservationPassed,
  normalizeAcknowledgement,
  normalizeSentSummary,
  projectProofFeed,
  sentSummaryMatches,
  verifyPerEnvelopeSnapshots,
  type FallbackObservation,
  type NetworkCategory,
  type ProofEvidenceRow,
  type ProofReport,
  type ProofStep,
  type SentSummarySnapshot,
} from "./unityB6D3CProof";

/**
 * Proof-only MatchRenderer3D ready bound. Measured cold-boot ready ≈ 66.37s;
 * authorized ceiling 90s. Does not change the production/default 15s renderer.
 */
const B6D3C_UNITY_READY_TIMEOUT_MS = 90_000;

// ── Bounded, harness-owned timeouts. Never derived from input. ────────────────
// Gate A `load` wait is intentionally greater than the proof renderer timeout so
// the renderer fail-open remains authoritative if Unity never becomes ready.
const TIMEOUT_MS: Record<ProofStep["timeoutLabel"], number> = {
  short: 1_500,
  standard: 6_000,
  load: 95_000,
};
/** Bounded wait for the merged cohort gate to resolve after the operator starts. */
const GATE_TIMEOUT_MS = 15_000;
/** Bounded window during which the fail-open state must stay terminal. */
const FALLBACK_STABILITY_MS = 1_000;
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

/**
 * Bounded synthetic Unity → React error. Presentation-only; no identity, match,
 * room, opponent, wallet, token or session fields.
 */
const PROOF_UNITY_REPORTED_ERROR_MESSAGE = "B6D3C-proof-synthetic-presentation-error";

/**
 * Post the existing validated Unity error event FROM the proof iframe's
 * contentWindow so MatchRenderer3D's origin+source checks accept it.
 * Parent-window postMessage / forged MessageEvent source is not used.
 */
function postUnityReportedErrorFromIframe(frame: HTMLIFrameElement): boolean {
  const child = frame.contentWindow;
  if (child === null) return false;
  let childOrigin = "";
  try {
    childOrigin = child.location.origin;
  } catch {
    return false;
  }
  const targetOrigin = window.location.origin;
  if (childOrigin !== targetOrigin) return false;
  const payload = {
    type: "PENALTY444_UNITY_EVENT",
    event: "error",
    payload: { message: PROOF_UNITY_REPORTED_ERROR_MESSAGE },
  };
  const doc = frame.contentDocument;
  if (doc === null || doc.defaultView !== child) return false;
  try {
    const script = doc.createElement("script");
    script.textContent =
      "parent.postMessage(" +
      JSON.stringify(payload) +
      ", " +
      JSON.stringify(targetOrigin) +
      ");";
    doc.documentElement.appendChild(script);
    script.remove();
    return true;
  } catch {
    return false;
  }
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

  // ── Operator initiation ────────────────────────────────────────────────────
  // `operatorRequested` gates the COHORT REQUESTS; `proofActivated` additionally
  // gates the HOST. Both start false, so mount performs no request and mounts no
  // iframe. `proofRunEpoch` re-keys the host so a prior terminal fallback can
  // never survive into a new local run.
  const [operatorRequested, setOperatorRequested] = useState(false);
  const [proofActivated, setProofActivated] = useState(false);
  const [proofRunEpoch, setProofRunEpoch] = useState(0);

  /**
   * Bounded cohort-gate diagnostic for the operator. This is ONLY the existing
   * `UnityPlayerFacingGateDiagnostic` enum member — never an email, token,
   * cookie, header, body, URL, secret or free-form error string. `null` means
   * the gate has not resolved in this run yet.
   */
  const [cohortDiagnostic, setCohortDiagnostic] = useState<UnityPlayerFacingGateDiagnostic | null>(
    null,
  );

  // Reused UNCHANGED from PR-2, plus the OPTIONAL bounded-diagnostic sink. The
  // gate still performs exactly one status request and one mint per resolution.
  const gate = useUnityPlayerFacingGate({
    requested: preconditionsMet && operatorRequested,
    onDiagnostic: setCohortDiagnostic,
  });
  const gateRef = useRef(gate);
  gateRef.current = gate;

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
  /** Transient UI-only indicator. NEVER retained in `rowsRef` or the report. */
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const [harnessError, setHarnessError] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<ProofEvidenceRow[]>([]);
  const ackLogRef = useRef<Array<NonNullable<ReturnType<typeof normalizeAcknowledgement>>>>([]);
  const sentLogRef = useRef<SentSummarySnapshot[]>([]);
  const readyCountRef = useRef(0);
  const maxIframeRef = useRef(0);
  const networkRef = useRef<Set<NetworkCategory>>(new Set());
  const networkStartRef = useRef<number | null>(null);
  const perfObserverRef = useRef<PerformanceObserver | null>(null);
  const startedRef = useRef(false);
  const harnessFaultRef = useRef(false);
  const activeStepRef = useRef<ProofStep | null>(null);

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

  const scoped = useCallback((selector: string): Element | null => {
    const root = containerRef.current;
    return root === null ? null : root.querySelector(selector);
  }, []);

  const readHostState = useCallback((): string | null => {
    const host = scoped("[data-unity-host]");
    return host === null ? null : host.getAttribute("data-host-state");
  }, [scoped]);

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

  // ── Network observation: OPERATOR-STARTED, window-filtered, categories only ─
  const stopNetworkObservation = useCallback(() => {
    const observer = perfObserverRef.current;
    perfObserverRef.current = null;
    if (observer === null) return;
    try {
      observer.disconnect();
    } catch {
      /* disconnect is best-effort */
    }
  }, []);

  /**
   * Start observing at the operator's press, BEFORE the cohort requests are
   * issued. `buffered: true` replays earlier entries, so every entry older than
   * the recorded start instant is discarded — pre-run Preview traffic is never
   * collected. Returns false when observation could not be established, which the
   * caller records as a bounded harness failure rather than silently claiming
   * network isolation.
   */
  const startNetworkObservation = useCallback((): boolean => {
    stopNetworkObservation();
    networkRef.current = new Set();
    networkStartRef.current = null;
    if (typeof PerformanceObserver === "undefined" || typeof performance === "undefined") {
      return false;
    }
    const pageOrigin = window.location.origin;
    const authOrigin = readAuthOrigin();
    const startedAt = performance.now();
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entryIsInsideProofWindow(entry.startTime, networkStartRef.current)) continue;
          // `entry.name` is discarded immediately; only the category is retained.
          networkRef.current.add(classifyNetworkUrl(entry.name, pageOrigin, authOrigin));
        }
      });
      observer.observe({ type: "resource", buffered: true });
      perfObserverRef.current = observer;
      networkStartRef.current = startedAt;
      return true;
    } catch {
      return false;
    }
  }, [stopNetworkObservation]);

  // The observer must never outlive the surface.
  useEffect(() => stopNetworkObservation, [stopNetworkObservation]);

  // ── Strict acknowledgement / send-confirmation listeners ───────────────────
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

  /** The merged host's send confirmation, reduced to its sanitized values. */
  const handleMessageSent = useCallback((summary: unknown) => {
    const snapshot = normalizeSentSummary(summary);
    if (snapshot !== null) sentLogRef.current.push(snapshot);
  }, []);

  // ── Step primitives ────────────────────────────────────────────────────────

  /** Find an acknowledgement (arriving after `from`) that satisfies `step`. */
  const findAck = useCallback(
    async (step: ProofStep, from: number) => {
      await waitUntil(() => {
        for (let i = from; i < ackLogRef.current.length; i++) {
          if (acknowledgementMatches(step, ackLogRef.current[i])) return true;
        }
        return false;
      }, TIMEOUT_MS[step.timeoutLabel]);

      for (let i = from; i < ackLogRef.current.length; i++) {
        if (acknowledgementMatches(step, ackLogRef.current[i])) return ackLogRef.current[i];
      }
      return null;
    },
    [],
  );

  /** Record a bounded failure for an unmatched acknowledgement. */
  const failAck = useCallback(
    (step: ProofStep, from: number) => {
      const stray = ackLogRef.current[from];
      if (stray !== undefined) {
        pushRow(buildEvidenceRowFromAck(step, stray, "fail", "unexpected_outcome"));
        return;
      }
      pushRow(
        buildHarnessEvidenceRow({
          step,
          status: "fail",
          hostState: readHostState(),
          iframeCount: iframes().length,
          failureCategory: "missing_acknowledgement",
        }),
      );
    },
    [iframes, pushRow, readHostState],
  );

  /**
   * HOST channel: publish one already-projected envelope, wait for the MERGED
   * host's `onMessageSent` confirmation, then for the acknowledgement. Both rows
   * are retained only after both succeed — no pending row survives.
   */
  const sendViaHost = useCallback(
    async (step: ProofStep, item: ViewerPresentationMessage): Promise<boolean> => {
      const ackFrom = ackLogRef.current.length;
      const sentFrom = sentLogRef.current.length;
      setPendingStep(step.step);
      setHostMessages((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item]));

      const confirmed = await waitUntil(() => {
        for (let i = sentFrom; i < sentLogRef.current.length; i++) {
          if (sentSummaryMatches(item.message, sentLogRef.current[i])) return true;
        }
        return false;
      }, TIMEOUT_MS[step.timeoutLabel]);
      if (!confirmed) {
        setPendingStep(null);
        pushRow(
          buildHarnessEvidenceRow({
            step,
            status: "fail",
            hostState: readHostState(),
            iframeCount: iframes().length,
            failureCategory: "missing_send_confirmation",
          }),
        );
        return false;
      }

      const ack = await findAck(step, ackFrom);
      setPendingStep(null);
      if (ack === null) {
        failAck(step, ackFrom);
        return false;
      }
      pushRow(buildOutboundEvidenceRow(step, item.message, "pass"));
      pushRow(buildEvidenceRowFromAck(step, ack, "pass"));
      return true;
    },
    [failAck, findAck, iframes, pushRow, readHostState],
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
      const ackFrom = ackLogRef.current.length;
      setPendingStep(step.step);
      // Explicit target origin — never "*".
      target.postMessage(envelope, window.location.origin);

      const ack = await findAck(step, ackFrom);
      setPendingStep(null);
      if (ack === null) {
        failAck(step, ackFrom);
        return false;
      }
      pushRow(buildOutboundEvidenceRow(step, envelope, "pass"));
      pushRow(buildEvidenceRowFromAck(step, ack, "pass"));
      return true;
    },
    [failAck, findAck, iframes, proofIframe, pushRow, readHostState],
  );

  // ── Fail-open observation ──────────────────────────────────────────────────
  const observeFallback = useCallback(async (): Promise<FallbackObservation> => {
    const terminal = () => readHostState() === "UNITY_FAILED_REACT_FALLBACK";
    // Bounded stability window: the state must stay terminal with zero iframes.
    let stable = true;
    const deadline = Date.now() + FALLBACK_STABILITY_MS;
    while (Date.now() < deadline) {
      if (iframes().length !== 0 || !terminal()) stable = false;
      await delay(POLL_MS);
    }
    const unityUnderlay = scoped("[data-unity-underlay]");
    const classes = unityUnderlay === null ? "" : (unityUnderlay.getAttribute("class") ?? "");
    const text = containerRef.current?.textContent ?? "";
    return {
      hostTerminal: terminal(),
      iframeCountZero: iframes().length === 0,
      unityUnderlayPresent: unityUnderlay !== null,
      proofUnderlayPresent: scoped("[data-b6d3c-underlay]") !== null,
      underlayVisible: classes.includes("opacity-100") && !classes.includes("opacity-0"),
      unitySlotAbsent: scoped("[data-unity-slot]") === null,
      noUnavailableCard: !text.includes("3D preview unavailable"),
      stableNoRemount: stable,
      // Terminal is per-instance in the merged host: the active instance must
      // still be the one that failed, and it must still be terminal.
      instanceStillTerminal: terminal(),
    };
  }, [iframes, readHostState, scoped]);

  // ── Local state clearing (shared by run and reset) ─────────────────────────
  const clearProofState = useCallback(() => {
    rowsRef.current = [];
    ackLogRef.current = [];
    sentLogRef.current = [];
    readyCountRef.current = 0;
    maxIframeRef.current = 0;
    networkRef.current = new Set();
    networkStartRef.current = null;
    harnessFaultRef.current = false;
    activeStepRef.current = null;
    setRows([]);
    setReport(null);
    setHarnessError(false);
    setCurrentStep(null);
    setPendingStep(null);
    // A new run must never display a diagnostic left over from a previous run,
    // and Reset must return the line to its initial safe state.
    setCohortDiagnostic(null);
  }, []);

  /**
   * Reset LOCAL proof state. Deactivates the host, drops the cohort request, and
   * re-keys the host so a prior terminal fallback cannot survive into a new run.
   * Disabled while a run is active.
   */
  const resetProof = useCallback(() => {
    if (running) return;
    stopNetworkObservation();
    setProofActivated(false);
    setOperatorRequested(false);
    setActiveInstance(PROOF_INSTANCE_A);
    setIdentity(feedA.identity);
    setHostMessages([]);
    clearProofState();
    startedRef.current = false;
    setProofRunEpoch((epoch) => epoch + 1);
  }, [clearProofState, feedA, running, stopNetworkObservation]);

  // ── The proof run ──────────────────────────────────────────────────────────
  const runProof = useCallback(async () => {
    if (startedRef.current) return;
    // 1. Verify the public preconditions before anything at all happens.
    if (!preconditionsMet) return;
    startedRef.current = true;

    // 2. Clear every prior ref and state value.
    clearProofState();
    setHostMessages([]);
    setActiveInstance(PROOF_INSTANCE_A);
    setIdentity(feedA.identity);
    setRunning(true);

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

    const finalize = () => {
      stopNetworkObservation();
      setCurrentStep(null);
      setPendingStep(null);
      setRunning(false);
      activeStepRef.current = null;
      try {
        setReport(
          buildProofReport({
            rows: rowsRef.current,
            maxIframeCount: maxIframeRef.current,
            networkCategories: Array.from(networkRef.current).sort(),
            harnessFault: harnessFaultRef.current,
          }),
        );
      } catch {
        // A report that would have contained something prohibited is NEVER shown.
        harnessFaultRef.current = true;
        setReport(null);
        setHarnessError(true);
      }
    };

    // Network observation begins BEFORE the cohort status/session requests.
    if (!startNetworkObservation()) {
      harnessFaultRef.current = true;
      setHarnessError(true);
      pushRow(
        buildHarnessEvidenceRow({
          step: step(1),
          status: "fail",
          failureCategory: "network_observation_unavailable",
        }),
      );
    }

    try {
      // 3. Request the cohort gate.
      activeStepRef.current = step(1);
      setCurrentStep(1);
      setOperatorRequested(true);

      // 4. Wait for the EXISTING cohort gate to resolve.
      const resolved = await waitUntil(
        () => gateRef.current === "authorized" || gateRef.current === "denied",
        GATE_TIMEOUT_MS,
      );
      if (!resolved || gateRef.current !== "authorized") {
        // Denied or unresolved ⇒ stay React-only and never start the proof.
        pushRow(
          buildHarnessEvidenceRow({
            step: step(1),
            status: "fail",
            hostState: readHostState(),
            iframeCount: iframes().length,
            failureCategory: resolved ? "gate_denied" : "timeout",
          }),
        );
        finalize();
        return;
      }

      // 5. Record the ready baseline BEFORE the host may activate, so step 1 can
      //    only pass on a ready event produced by THIS activation.
      const readyBaseline = readyCountRef.current;

      // 6. Activate the host.
      setProofActivated(true);
      await delay(POLL_MS);

      // 7–8. A FRESH ready event, produced after activation, is required.
      const ready = await waitUntil(
        () => readyCountRef.current > readyBaseline,
        TIMEOUT_MS[step(1).timeoutLabel],
      );
      observe(1, ready && iframes().length === 1, "timeout");
      if (!ready) throw new Error("not-ready");

      // 2 — bootstrap 0/0.
      activeStepRef.current = step(2);
      setCurrentStep(2);
      if (!(await sendViaHost(step(2), feedA.messages[0]))) throw new Error("step-2");

      // 3 — round_result GOAL (no score).
      activeStepRef.current = step(3);
      setCurrentStep(3);
      if (!(await sendViaHost(step(3), feedA.messages[1]))) throw new Error("step-3");

      // 4 — the authoritative state sync carries the score change.
      activeStepRef.current = step(4);
      setCurrentStep(4);
      if (!(await sendViaHost(step(4), feedA.messages[2]))) throw new Error("step-4");

      // 5 — GATE C, proven from the ACKNOWLEDGEMENTS: sequence 1 must still
      //     report 0/0 while sequence 3 reports 0/1. Host visibility is an
      //     ADDITIONAL requirement, never a substitute.
      activeStepRef.current = step(5);
      setCurrentStep(5);
      for (const row of buildSnapshotEvidenceRows(step(5), ackLogRef.current)) pushRow(row);
      const snapshots = verifyPerEnvelopeSnapshots(ackLogRef.current);
      const hostVisible = readHostState() === "UNITY_READY_VISIBLE" && iframes().length === 1;
      observe(5, snapshots.passed && hostVisible, "unexpected_outcome");
      if (!snapshots.passed || !hostVisible) throw new Error("step-5");

      // 6 — duplicate sequence 3 (distinct proof message id, same sequence).
      activeStepRef.current = step(6);
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
      activeStepRef.current = step(7);
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
      activeStepRef.current = step(8);
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
      activeStepRef.current = step(9);
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

      // 10 — SUDDEN_DEATH; the exact suddenDeathRound must come back unchanged.
      activeStepRef.current = step(10);
      setCurrentStep(10);
      if (!(await sendViaHost(step(10), feedA.messages[3]))) throw new Error("step-10");

      // 11 — instance transition: same room, higher instance, sequence exactly 1.
      activeStepRef.current = step(11);
      setCurrentStep(11);
      setActiveInstance(PROOF_INSTANCE_B);
      setIdentity(feedB.identity);
      setHostMessages([]);
      await delay(POLL_MS);
      if (!(await sendViaHost(step(11), feedB.messages[0]))) throw new Error("step-11");

      // 12 — the superseded instance is still rejected afterwards.
      activeStepRef.current = step(12);
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
      activeStepRef.current = step(13);
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
      activeStepRef.current = step(14);
      setCurrentStep(14);
      if (!(await sendViaHost(step(14), feedB.messages[1]))) throw new Error("step-14");

      // 15 — a Unity-reported presentation error is terminal for this instance:
      //      the renderer is unmounted, the React underlay stays mounted AND
      //      visible, no "unavailable" card is left behind, and nothing remounts.
      //      The message is posted FROM the proof iframe contentWindow so the
      //      production origin+source checks accept it. This is not an HTML
      //      iframe resource/network error.
      activeStepRef.current = step(15);
      setCurrentStep(15);
      const target = proofIframe();
      if (target === null) {
        observe(15, false, "iframe_invariant_violation");
        throw new Error("step-15-iframe");
      }
      if (!postUnityReportedErrorFromIframe(target)) {
        observe(15, false, "iframe_invariant_violation");
        throw new Error("step-15-inject");
      }
      await waitUntil(
        () => readHostState() === "UNITY_FAILED_REACT_FALLBACK" && iframes().length === 0,
        TIMEOUT_MS[step(15).timeoutLabel],
      );
      const fallback = await observeFallback();
      pushRow(buildFallbackEvidenceRow(step(15), fallback, readHostState(), iframes().length));
      if (!fallbackObservationPassed(fallback)) throw new Error("step-15");

      // 16 — sanitization: no synthetic raw identifier anywhere in the projected
      //      feeds or in the accumulated evidence.
      activeStepRef.current = step(16);
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
      // Any harness fault is recorded BOTH as an explicit bounded evidence row
      // for the active step AND as the report-level flag, so it can never be
      // reduced to a UI label on an otherwise-passing report.
      harnessFaultRef.current = true;
      setHarnessError(true);
      const failedStep = activeStepRef.current;
      if (failedStep !== null) {
        pushRow(
          buildHarnessEvidenceRow({
            step: failedStep,
            status: "fail",
            hostState: readHostState(),
            iframeCount: iframes().length,
            failureCategory: "harness_error",
          }),
        );
      }
    } finally {
      finalize();
    }
  }, [
    clearProofState,
    feedA,
    feedB,
    iframes,
    observeFallback,
    preconditionsMet,
    proofIframe,
    pushRow,
    readHostState,
    sendDirect,
    sendViaHost,
    startNetworkObservation,
    stopNetworkObservation,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────
  // Activation requires the operator's press AND the explicit activation step AND
  // an authorized gate. An authorized gate alone mounts nothing.
  const playerFacingAuthorized = operatorRequested && proofActivated && gate === "authorized";
  const canRun = preconditionsMet && !running && !startedRef.current;

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
          <li>operator started: {operatorRequested ? "yes" : "no"}</li>
          <li>cohort gate: {gate}</li>
          <li>cohort diagnostic: {cohortDiagnostic ?? "none"}</li>
          <li>host activated: {playerFacingAuthorized ? "yes" : "no"}</li>
        </ul>
        <p className="mt-2 text-xs text-zinc-400">
          {preconditionsMet
            ? "No cohort request and no Unity renderer starts until Run is pressed."
            : "The proof cannot run until every flag is enabled and the build URL is the protected entry point. Nothing was requested from the network."}
        </p>
      </section>

      {/* Two controls only. No pick, room, matchmaking or wallet control exists. */}
      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runProof()}
          disabled={!canRun}
          className="rounded-xl border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-sm font-bold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Running…" : "Run mock proof"}
        </button>
        <button
          type="button"
          onClick={resetProof}
          disabled={running}
          className="rounded-xl border border-zinc-600 bg-zinc-800/60 px-4 py-2 text-sm font-bold text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset local proof state
        </button>
        <span className="text-xs text-zinc-400">
          {currentStep === null
            ? `${PROOF_STEPS.length} steps · ${rows.length} evidence rows · run ${proofRunEpoch}`
            : `step ${currentStep} / ${PROOF_STEPS.length}${
                pendingStep === null ? "" : " · awaiting acknowledgement"
              }`}
        </span>
      </section>

      {/* The MERGED host, unmodified. Exactly one may exist on this page. */}
      <section className="h-[360px] w-full overflow-hidden rounded-2xl border border-zinc-700">
        <UnityPresentationHost
          key={proofRunEpoch}
          playerFacingAuthorized={playerFacingAuthorized}
          matchInstanceId={activeInstance}
          messages={hostMessages}
          identity={identity}
          correlation={null}
          readyTimeoutMs={B6D3C_UNITY_READY_TIMEOUT_MS}
          onReady={() => {}}
          onError={() => {}}
          onMessageSent={handleMessageSent}
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
        <table className="mt-2 w-full min-w-[820px] text-left text-xs">
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
              <th className="py-1 pr-2">sdRound</th>
              <th className="py-1 pr-2">players</th>
              <th className="py-1 pr-2">reason</th>
              <th className="py-1 pr-2">host</th>
              <th className="py-1 pr-2">frames</th>
              <th className="py-1 pr-2">fallback</th>
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
                <td className="py-1 pr-2">{row.suddenDeathRound ?? "—"}</td>
                <td className="py-1 pr-2">{row.playerCount ?? "—"}</td>
                <td className="py-1 pr-2">{row.rejectionReason ?? "—"}</td>
                <td className="py-1 pr-2">{row.hostState ?? "—"}</td>
                <td className="py-1 pr-2">{row.iframeCount ?? "—"}</td>
                <td className="py-1 pr-2">
                  {row.fallback === null
                    ? "—"
                    : Object.entries(row.fallback)
                        .map(([name, value]) => `${name}=${value ? "1" : "0"}`)
                        .join(" ")}
                </td>
                <td className="py-1 pr-2 font-bold">{row.status}</td>
                <td className="py-1">{row.failureCategory}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="py-2 text-zinc-500" colSpan={19}>
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
            </p>
            <p>harness fault: {report.harnessFault ? "yes" : "no"}</p>
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
