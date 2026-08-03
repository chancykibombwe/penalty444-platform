"use client";

/**
 * MatchRenderer3D — Unity / 3D Match Experience, Phase B1 (passive React bridge).
 *
 * PASSIVE RENDERER SHELL ONLY. This is the reusable React half of the Unity
 * bridge described in `docs/unity-3d-prototype-plan.md`. It does NOT power any
 * live match — it is intentionally NOT mounted into the match page in this
 * phase. Live integration (feeding it authoritative, already-resolved match
 * state) is a later phase.
 *
 * This is a clean re-create of the old parked draft (PR #162) on top of the
 * current, hardened master. The behavior contract is unchanged; the only
 * improvement is that the shared match vocabulary (Lane / ShotResult /
 * MatchPhase / RevealStage) is now IMPORTED from the canonical
 * `matchPresentation.ts` instead of being re-declared here, so the bridge can
 * never drift from the real match types.
 *
 * Architecture rules — enforced here (Phase B1):
 *   - The Node.js realtime server stays the single source of truth.
 *   - Unity / 3D is PASSIVE visual presentation only.
 *   - React keeps Socket.IO ownership — this component opens NO socket.
 *   - React keeps auth ownership — this component reads NO Supabase token,
 *     NO JWT, NO session, NO service-role key, and passes none to Unity.
 *   - No match-result computation, no pick submission, no Supabase writes,
 *     no stats/progression, no wallet/economy.
 *   - Unity does NOT control results, picks, wallet, stats, or auth.
 *
 * It reads only two PUBLIC, build-time env vars and renders accordingly:
 *   - NEXT_PUBLIC_UNITY_MATCH_ENABLED — when not "true", renders null.
 *   - NEXT_PUBLIC_UNITY_BUILD_URL     — when missing, renders a safe placeholder.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Lane,
  ShotResult,
  MatchPhase,
  RevealStage,
} from "./matchPresentation";
import type { PresentationEnvelope } from "./unityPresentationProtocol";
import {
  ShadowDispatchQueue,
  summarizeSentMessage,
  isEnvelopeForActiveInstance,
  type SentSummary,
} from "./unityPresentationShadow";

/**
 * Outbound-to-Unity message: the existing legacy `UnityInbound` OR a versioned
 * B6D1 `PresentationEnvelope` (B6D2A). The legacy contract is preserved; the
 * versioned envelope is only ever supplied when the third B6D2A flag is on.
 */
export type UnityShadowMessage = UnityInbound | PresentationEnvelope;

// Re-export the canonical match types so future Unity-bridge consumers can
// import them from one place without reaching back into presentation code.
export type { Lane, ShotResult, MatchPhase, RevealStage };

/**
 * Bridge-level match stage exposed to Unity. This mirrors the client
 * `RevealStage` ("IDLE" | "LOCKED" | "REVEALING" | "REVEALED") and adds a
 * terminal "ENDED" for match completion. It is a PRESENTATION signal only —
 * the server decides when a match is actually over; this just tells Unity what
 * to animate.
 */
export type BridgeMatchStage = RevealStage | "ENDED";

// ─── React ↔ Unity event / data contract ─────────────────────────────────────
// Mirrors the dev harness in app/dev/unity-prototype/UnityPrototypeClient.tsx.

export type RoundResultPayload = {
  kickerLane: Lane;
  keeperLane: Lane;
  result: ShotResult;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  phase: MatchPhase;
};

/**
 * React → Unity (inbound TO Unity). Every payload is derived purely from match
 * state the server has ALREADY resolved. Sent via postMessage in a later phase;
 * the contract lives here with the renderer. Never invoked in Phase B1.
 */
export type UnityInbound =
  | {
      type: "PENALTY444_MATCH_EVENT";
      event: "round_result";
      payload: RoundResultPayload;
    }
  | {
      type: "PENALTY444_MATCH_EVENT";
      event: "match_end";
      payload: { winnerId: string | null; isDraw: boolean };
    }
  | {
      type: "PENALTY444_MATCH_EVENT";
      event: "staging_begin";
      payload: { startsAt: number };
    }
  | { type: "PENALTY444_MATCH_EVENT"; event: "reset"; payload: null };

/** Unity → React (outbound FROM Unity). The ONLY messages this shell accepts. */
export type UnityOutbound =
  | { type: "PENALTY444_UNITY_EVENT"; event: "ready"; payload: null }
  | {
      type: "PENALTY444_UNITY_EVENT";
      event: "animation_complete";
      payload: { round: number };
    }
  | {
      type: "PENALTY444_UNITY_EVENT";
      event: "error";
      payload: { message: string };
    };

// ─── Inbound message validation (Unity → React) ──────────────────────────────

/**
 * Validate a raw `postMessage` payload claimed to come from the Unity build.
 * Accepts ONLY `type: "PENALTY444_UNITY_EVENT"` with one of the three known
 * events and a well-formed payload; returns null (silently ignored) otherwise.
 *
 * Safety: never throws on malformed input, never executes anything the message
 * asks for, never trusts arbitrary fields. The caller MUST verify
 * `event.origin` before calling this (the component does). Unity messages are
 * treated as presentation timing hints only — they never carry or influence
 * match results, picks, auth, stats, or money.
 */
export function validateUnityMessage(data: unknown): UnityOutbound | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; event?: unknown; payload?: unknown };
  if (msg.type !== "PENALTY444_UNITY_EVENT") return null;

  switch (msg.event) {
    case "ready":
      return { type: "PENALTY444_UNITY_EVENT", event: "ready", payload: null };
    case "animation_complete": {
      const p = msg.payload as { round?: unknown } | null;
      if (!p || typeof p.round !== "number" || !Number.isFinite(p.round)) {
        return null;
      }
      return {
        type: "PENALTY444_UNITY_EVENT",
        event: "animation_complete",
        payload: { round: p.round },
      };
    }
    case "error": {
      const p = msg.payload as { message?: unknown } | null;
      const message =
        p && typeof p.message === "string" ? p.message : "Unknown Unity error";
      return {
        type: "PENALTY444_UNITY_EVENT",
        event: "error",
        payload: { message },
      };
    }
    default:
      return null; // unknown event → silently ignore
  }
}

/**
 * Later-phase helper (defined now, used later): post an authoritative match
 * event INTO the Unity iframe. It only forwards already-resolved state; it
 * never computes outcomes. Not invoked anywhere in Phase B1.
 */
export function postMatchEventToUnity(
  target: Window | null,
  message: UnityInbound,
  targetOrigin: string
): void {
  if (!target) return;
  target.postMessage(message, targetOrigin);
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Presentation-only readiness timeout for the OPTIONAL shadow iframe. If Unity
 * has not emitted `ready` within this window the preview fails open (see
 * `markUnavailable`). This never gates the React match in any way.
 */
const UNITY_READY_TIMEOUT_MS = 15_000;

/** Presentation-only lifecycle of the optional shadow iframe. */
type UnityRendererStatus = "loading" | "ready" | "unavailable";

type MatchRenderer3DProps = {
  /**
   * LATEST-mode (legacy) message to forward INTO Unity. Held pending until Unity
   * signals `ready`, then sent at most once per `messageId` per iframe lifecycle.
   * Used when `deliveryMode` is "latest" (default). The renderer never derives
   * outcome from this — it only forwards server-resolved state.
   */
  message?: UnityShadowMessage | null;
  /**
   * Stable identity for `message` (LATEST mode). A given id is delivered at most
   * once per iframe lifecycle (deduplication).
   */
  messageId?: string | number | null;
  /**
   * FIFO-mode (B6D2A) ordered message list. Each `{ id, message }` is enqueued in
   * arrival order, deduped by id (across queued + already-sent), and flushed in
   * exact FIFO order once Unity is ready. Used only when `deliveryMode` is "fifo".
   */
  messages?: ReadonlyArray<{ id: string; message: UnityShadowMessage }>;
  /**
   * Delivery mode. "latest" (default) preserves the legacy single-pending
   * behavior; "fifo" enables the B6D2A ordered queue.
   */
  deliveryMode?: "latest" | "fifo";
  /**
   * FIFO mode only — the coordinator's active protocol matchInstanceId. When it
   * changes, the queue and per-lifecycle sent ids are cleared; the renderer never
   * infers an instance from an incoming message.
   */
  activeMatchInstanceId?: string | null;
  /**
   * Optional Unity → React event callbacks. The renderer never derives match
   * outcome from these — they only drive presentation/animation timing.
   */
  onReady?: () => void;
  onAnimationComplete?: (round: number) => void;
  onError?: (message: string) => void;
  /**
   * Fired after a message is delivered to Unity, with SANITIZED metadata only
   * (messageId, event, and instance/sequence for versioned envelopes). Never
   * receives raw payloads; callback errors never break the renderer.
   */
  onMessageSent?: (summary: SentSummary) => void;
  /**
   * B6D3B PR-2 — decorative-underlay isolation. When true, the iframe and its
   * wrapper cannot capture pointer input or keyboard focus and are hidden from the
   * accessibility tree, while still receiving React `postMessage` traffic
   * normally. Defaults to false, which preserves every existing behaviour exactly
   * (transport, URL selection, env gates, ready timeout, message validation,
   * origin checks, FIFO/latest delivery, instance reset, acknowledgement and
   * failure handling are all untouched).
   */
  presentationOnly?: boolean;
};

export default function MatchRenderer3D({
  message = null,
  messageId = null,
  messages,
  deliveryMode = "latest",
  activeMatchInstanceId = null,
  onReady,
  onAnimationComplete,
  onError,
  onMessageSent,
  presentationOnly = false,
}: MatchRenderer3DProps) {
  // Public, build-time env flags only. No secrets, no tokens.
  const enabled = process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true";
  const buildUrl = (process.env.NEXT_PUBLIC_UNITY_BUILD_URL ?? "").trim();

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Hold latest callbacks in a ref so the listener subscribes once.
  const callbacksRef = useRef({ onReady, onAnimationComplete, onError, onMessageSent });
  callbacksRef.current = { onReady, onAnimationComplete, onError, onMessageSent };

  // Send-queue state, all in refs so the once-subscribed listener stays stable.
  const readyRef = useRef(false);
  const pendingRef = useRef<{ message: UnityShadowMessage; id: string | number } | null>(
    null
  );
  const sentIdsRef = useRef<Set<string | number>>(new Set());

  // FIFO delivery queue (B6D2A). Created lazily; only used in "fifo" mode.
  const fifoQueueRef = useRef<ShadowDispatchQueue | null>(null);
  const fifoInstanceRef = useRef<string | null>(activeMatchInstanceId);

  // Sanitized "message sent" notification — callback errors never break render.
  const notifySent = useCallback((message: UnityShadowMessage, id: string | number) => {
    const cb = callbacksRef.current.onMessageSent;
    if (!cb) return;
    try {
      cb(summarizeSentMessage(message, String(id)));
    } catch {
      /* onMessageSent must never break the renderer */
    }
  }, []);

  // Presentation-only lifecycle (B5B3). Never gates the React match.
  const [status, setStatus] = useState<UnityRendererStatus>("loading");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const unavailableRef = useRef(false);
  const readyTimeoutRef = useRef<number | null>(null);

  const clearReadyTimeout = useCallback(() => {
    if (readyTimeoutRef.current !== null) {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
  }, []);

  // Idempotent fail-open transition into the unavailable state. Presentation
  // only: it never throws, never affects React, and fires `onError` at most once.
  const markUnavailable = useCallback(
    (reason: string) => {
      if (unavailableRef.current) return;
      unavailableRef.current = true;
      clearReadyTimeout();
      readyRef.current = false;
      setStatus("unavailable");
      setUnavailableReason(reason);
      try {
        callbacksRef.current.onError?.(reason);
      } catch {
        /* onError must never break the renderer */
      }
    },
    [clearReadyTimeout]
  );

  // Arm the presentation-only readiness timeout for the current iframe lifecycle.
  const armReadyTimeout = useCallback(() => {
    if (unavailableRef.current) return;
    clearReadyTimeout();
    readyTimeoutRef.current = window.setTimeout(() => {
      readyTimeoutRef.current = null;
      markUnavailable("3D preview did not become ready.");
    }, UNITY_READY_TIMEOUT_MS);
  }, [clearReadyTimeout, markUnavailable]);

  // Send the latest pending message to Unity — only when ready, only once per
  // messageId per iframe lifecycle, always same-origin (never "*"). A caught
  // delivery exception fails the preview open (markUnavailable), never React.
  const flushPending = useCallback(() => {
    if (!readyRef.current || unavailableRef.current) return;
    const pending = pendingRef.current;
    if (!pending) return;
    if (sentIdsRef.current.has(pending.id)) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    try {
      target.postMessage(pending.message, window.location.origin);
      sentIdsRef.current.add(pending.id);
      notifySent(pending.message, pending.id);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[unity-shadow] postMessage failed", error);
      }
      markUnavailable("3D preview message delivery failed.");
    }
  }, [markUnavailable, notifySent]);

  // FIFO flush (B6D2A). Drains the queue in exact arrival order and posts each
  // same-origin (never "*"). A delivery exception fails the preview open, never
  // React. Only runs in "fifo" mode once Unity is ready.
  const flushFifo = useCallback(() => {
    if (!readyRef.current || unavailableRef.current) return;
    const queue = fifoQueueRef.current;
    if (!queue) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    const batch = queue.drain();
    for (const item of batch) {
      try {
        target.postMessage(item.message, window.location.origin);
        notifySent(item.message as UnityShadowMessage, item.id);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[unity-b6d2-shadow] postMessage failed", error);
        }
        markUnavailable("3D preview message delivery failed.");
        return;
      }
    }
  }, [markUnavailable, notifySent]);

  useEffect(() => {
    // Only listen when there is actually an iframe build to listen to.
    if (!enabled || !buildUrl) return;

    function handleMessage(event: MessageEvent) {
      // Same-origin only, AND only from THIS iframe's window. A cross-origin/CDN
      // build must be served from this origin for its messages to be accepted.
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;

      const msg = validateUnityMessage(event.data);
      if (!msg) return;

      const cb = callbacksRef.current;
      if (msg.event === "ready") {
        if (unavailableRef.current) return; // don't resurrect a failed preview
        clearReadyTimeout();
        readyRef.current = true;
        setStatus("ready");
        if (deliveryMode === "fifo") {
          // FIFO ready policy: a shadow preview that was NOT ready when an
          // animation happened does NOT replay that historical animation later.
          // Discard any pre-ready FIFO history, then let the parent's onReady
          // publish a fresh ready_resync (current authoritative match_state_sync),
          // which is sent normally once it arrives — we do NOT flush pre-ready
          // history here.
          fifoQueueRef.current?.reset();
          cb.onReady?.();
        } else {
          cb.onReady?.();
          flushPending();
        }
      } else if (msg.event === "animation_complete") {
        cb.onAnimationComplete?.(msg.payload.round);
      } else if (msg.event === "error") {
        // Fail open on a Unity-reported error (idempotent).
        markUnavailable("3D preview reported an error.");
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [enabled, buildUrl, deliveryMode, flushPending, flushFifo, clearReadyTimeout, markUnavailable]);

  // LATEST mode (legacy): track the latest React → Unity message and try to send
  // it. If Unity is not ready yet, it stays pending and is flushed on `ready`.
  useEffect(() => {
    if (!enabled || !buildUrl) return;
    if (deliveryMode !== "latest") return;
    if (!message || messageId == null) return;
    pendingRef.current = { message, id: messageId };
    flushPending();
  }, [enabled, buildUrl, deliveryMode, message, messageId, flushPending]);

  // FIFO mode (B6D2A): an explicit active-instance change clears the queue and
  // per-lifecycle sent ids. Declared BEFORE the enqueue effect so a same-render
  // instance change resets before new-instance messages are enqueued. The
  // renderer never infers an instance from an incoming message.
  useEffect(() => {
    if (!enabled || !buildUrl) return;
    if (deliveryMode !== "fifo") return;
    if (activeMatchInstanceId === fifoInstanceRef.current) return;
    fifoInstanceRef.current = activeMatchInstanceId;
    fifoQueueRef.current?.reset();
  }, [enabled, buildUrl, deliveryMode, activeMatchInstanceId]);

  // FIFO mode (B6D2A): enqueue new messages in arrival order (deduped by id) and
  // flush them in FIFO order once ready. Queue overflow fails the preview open;
  // React continues normally.
  useEffect(() => {
    if (!enabled || !buildUrl) return;
    if (deliveryMode !== "fifo") return;
    if (!fifoQueueRef.current) fifoQueueRef.current = new ShadowDispatchQueue(32);
    const queue = fifoQueueRef.current;
    for (const item of messages ?? []) {
      // Defensive isolation: only enqueue a validated versioned envelope for the
      // current active instance. A foreign-instance or unvalidatable message is
      // rejected (never enqueued) — the active instance is never inferred from a
      // message.
      if (!isEnvelopeForActiveInstance(item.message, activeMatchInstanceId)) {
        continue;
      }
      const res = queue.enqueue(item.id, item.message);
      if (!res.ok && res.reason === "overflow") {
        markUnavailable("3D preview message queue overflow.");
        return;
      }
      // duplicate → silently skipped (already queued or already sent)
    }
    flushFifo();
  }, [enabled, buildUrl, deliveryMode, messages, activeMatchInstanceId, flushFifo, markUnavailable]);

  // Arm the readiness timeout for this component lifecycle; clear on unmount.
  useEffect(() => {
    if (!enabled || !buildUrl) return;
    armReadyTimeout();
    return () => clearReadyTimeout();
  }, [enabled, buildUrl, armReadyTimeout, clearReadyTimeout]);

  // iframe (re)load → back to loading; Unity no longer ready; clear the per-
  // lifecycle sent set; re-arm a fresh readiness timeout.
  const handleIframeLoad = useCallback(() => {
    if (unavailableRef.current) return;
    readyRef.current = false;
    sentIdsRef.current.clear();
    // FIFO mode: on reload, clear the queue + sent-id history; the parent's
    // `ready` callback publishes a fresh state sync. Old round_result history is
    // never replayed.
    if (deliveryMode === "fifo") fifoQueueRef.current?.reset();
    setStatus("loading");
    armReadyTimeout();
  }, [armReadyTimeout, deliveryMode]);

  // Native iframe load failure (network error) → fail open (idempotent).
  const handleIframeError = useCallback(() => {
    markUnavailable("3D preview failed to load.");
  }, [markUnavailable]);

  // Flag off → render nothing. Guarantees zero footprint on the live build.
  if (!enabled) return null;

  // Enabled but no build configured → existing safe configuration placeholder.
  if (!buildUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-dashed border-arena-border bg-arena-surface px-4 py-8 text-center"
        aria-label="3D match renderer placeholder"
      >
        <div>
          <p className="text-sm font-bold text-zinc-300">3D match renderer</p>
          <p className="mt-1 text-xs text-zinc-500">
            Enabled, but NEXT_PUBLIC_UNITY_BUILD_URL is not configured. A later
            phase wires the live Unity build.
          </p>
        </div>
      </div>
    );
  }

  // Unavailable → the iframe is UNMOUNTED and a compact fail-open card is shown.
  // The React match continues normally; no further sends are attempted.
  if (status === "unavailable") {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-arena-border bg-arena-surface px-4 py-6 text-center"
        role="status"
        aria-live="polite"
      >
        <div>
          <p className="text-sm font-bold text-zinc-300">3D preview unavailable</p>
          <p className="mt-1 text-xs text-zinc-500">
            The React match continues normally.
          </p>
          {process.env.NODE_ENV !== "production" && unavailableReason ? (
            <p className="mt-2 text-[10px] text-zinc-600">{unavailableReason}</p>
          ) : null}
        </div>
      </div>
    );
  }

  // loading | ready → passive iframe shell. A non-interactive "loading" overlay
  // shows until Unity emits `ready`. NO sockets, NO auth, NO match-control input.
  return (
    <div
      className={`relative h-full w-full${presentationOnly ? " pointer-events-none" : ""}`}
      data-presentation-only={presentationOnly ? "true" : undefined}
      aria-hidden={presentationOnly ? "true" : undefined}
      // `inert` removes the subtree from focus/AT where the browser supports it.
      {...(presentationOnly ? { inert: true } : {})}
    >
      <iframe
        ref={iframeRef}
        src={buildUrl}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        title="Penalty444 3D match renderer"
        className={`h-full w-full rounded-2xl border border-arena-border bg-black${
          presentationOnly ? " pointer-events-none" : ""
        }`}
        allow="autoplay; fullscreen"
        {...(presentationOnly
          ? { tabIndex: -1, "aria-hidden": true as const, inert: true }
          : {})}
      />
      {status === "loading" && !presentationOnly ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-black/55"
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <p className="text-sm font-bold text-cyan-200">Loading 3D preview…</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
              React match remains active
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
