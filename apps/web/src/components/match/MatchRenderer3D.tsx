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

import { useCallback, useEffect, useRef } from "react";
import type {
  Lane,
  ShotResult,
  MatchPhase,
  RevealStage,
} from "./matchPresentation";

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

type MatchRenderer3DProps = {
  /**
   * Latest authoritative, already-resolved presentation message to forward INTO
   * Unity (B5A: only `round_result`). Held pending until Unity signals `ready`,
   * then sent at most once per `messageId` for the current iframe lifecycle. The
   * renderer never derives outcome from this — it only forwards server-resolved
   * state. When null/undefined, nothing is sent.
   */
  message?: UnityInbound | null;
  /**
   * Stable identity for `message`. A given id is delivered to Unity at most once
   * per iframe lifecycle (deduplication). Changing it (new round) allows a new
   * send; the same id will not be re-sent unless the iframe reloads.
   */
  messageId?: string | number | null;
  /**
   * Optional Unity → React event callbacks. The renderer never derives match
   * outcome from these — they only drive presentation/animation timing.
   */
  onReady?: () => void;
  onAnimationComplete?: (round: number) => void;
  onError?: (message: string) => void;
};

export default function MatchRenderer3D({
  message = null,
  messageId = null,
  onReady,
  onAnimationComplete,
  onError,
}: MatchRenderer3DProps) {
  // Public, build-time env flags only. No secrets, no tokens.
  const enabled = process.env.NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true";
  const buildUrl = (process.env.NEXT_PUBLIC_UNITY_BUILD_URL ?? "").trim();

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Hold latest callbacks in a ref so the listener subscribes once.
  const callbacksRef = useRef({ onReady, onAnimationComplete, onError });
  callbacksRef.current = { onReady, onAnimationComplete, onError };

  // Send-queue state, all in refs so the once-subscribed listener stays stable.
  const readyRef = useRef(false);
  const pendingRef = useRef<{ message: UnityInbound; id: string | number } | null>(
    null
  );
  const sentIdsRef = useRef<Set<string | number>>(new Set());

  // Send the latest pending message to Unity — only when ready, only once per
  // messageId per iframe lifecycle, always same-origin (never "*").
  const flushPending = useCallback(() => {
    if (!readyRef.current) return;
    const pending = pendingRef.current;
    if (!pending) return;
    if (sentIdsRef.current.has(pending.id)) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(pending.message, window.location.origin);
    sentIdsRef.current.add(pending.id);
  }, []);

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
        readyRef.current = true;
        cb.onReady?.();
        flushPending();
      } else if (msg.event === "animation_complete") {
        cb.onAnimationComplete?.(msg.payload.round);
      } else if (msg.event === "error") cb.onError?.(msg.payload.message);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [enabled, buildUrl, flushPending]);

  // Track the latest React → Unity message and try to send it. If Unity is not
  // ready yet, it stays pending and is flushed on the next `ready`.
  useEffect(() => {
    if (!enabled || !buildUrl) return;
    if (!message || messageId == null) return;
    pendingRef.current = { message, id: messageId };
    flushPending();
  }, [enabled, buildUrl, message, messageId, flushPending]);

  // iframe (re)load → Unity is no longer ready; clear the per-lifecycle sent set
  // so the latest pending message can be delivered again after the new `ready`.
  const handleIframeLoad = useCallback(() => {
    readyRef.current = false;
    sentIdsRef.current.clear();
  }, []);

  // Flag off → render nothing. Guarantees zero footprint on the live build.
  if (!enabled) return null;

  // Enabled but no build configured → safe internal placeholder (not shown to
  // users in Phase B1 because this component is not mounted anywhere live).
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

  // Enabled + build URL present → passive iframe shell. A later phase finalizes
  // the Unity loader, the React→Unity send path, and DOM fallback wiring. This
  // shell holds NO sockets, NO auth, and forwards NO match-control input.
  return (
    <iframe
      ref={iframeRef}
      src={buildUrl}
      onLoad={handleIframeLoad}
      title="Penalty444 3D match renderer"
      className="h-full w-full rounded-2xl border border-arena-border bg-black"
      allow="autoplay; fullscreen"
    />
  );
}
