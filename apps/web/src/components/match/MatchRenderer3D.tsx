"use client";

/**
 * MatchRenderer3D — Unity / 3D Match Experience, Phase B1 (React bridge stub).
 *
 * PASSIVE RENDERER SHELL ONLY. This component is the reusable React half of the
 * Unity bridge described in `docs/unity-3d-prototype-plan.md`. It does NOT yet
 * power any live match — it is intentionally not mounted into the match page in
 * this phase (live integration is Phase B2).
 *
 * Architecture rules (plan §4, §11) — enforced here:
 *   - The Node.js realtime server stays the single source of truth.
 *   - Unity / 3D is PASSIVE visual presentation only.
 *   - React keeps Socket.IO ownership — this component opens NO socket.
 *   - React keeps auth ownership — this component reads NO Supabase token,
 *     NO JWT, NO session, and passes none to Unity.
 *   - No match-result computation, no pick submission, no Supabase writes.
 *
 * It only reads two PUBLIC env vars and renders nothing / a placeholder / an
 * iframe shell accordingly:
 *   - NEXT_PUBLIC_UNITY_MATCH_ENABLED  — when not "true", renders null.
 *   - NEXT_PUBLIC_UNITY_BUILD_URL      — when missing, renders a safe placeholder.
 *
 * Phase B2 (future) will mount this component into the match page and feed it
 * authoritative `PENALTY444_MATCH_EVENT` payloads derived from match state the
 * server has already resolved — never the other way around.
 */

import { useEffect, useRef } from "react";

// ─── §7 event / data contract (React ↔ Unity) ────────────────────────────────
// Mirrors apps/web/src/app/dev/unity-prototype/UnityPrototypeClient.tsx.

export type Lane = "LEFT" | "CENTER" | "RIGHT";
export type ShotResult = "GOAL" | "SAVE" | "DRAW";
export type MatchPhase = "NORMAL" | "SUDDEN_DEATH";

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
 * React → Unity (inbound TO Unity). Derived purely from already-authoritative
 * match state. Sent via postMessage in Phase B2; defined here so the contract
 * lives with the renderer.
 */
export type UnityInbound =
  | { type: "PENALTY444_MATCH_EVENT"; event: "round_result"; payload: RoundResultPayload }
  | {
      type: "PENALTY444_MATCH_EVENT";
      event: "match_end";
      payload: { winnerId: string | null; isDraw: boolean };
    }
  | { type: "PENALTY444_MATCH_EVENT"; event: "staging_begin"; payload: { startsAt: number } }
  | { type: "PENALTY444_MATCH_EVENT"; event: "reset"; payload: null };

/** Unity → React (outbound FROM Unity). The only messages this shell accepts. */
export type UnityOutbound =
  | { type: "PENALTY444_UNITY_EVENT"; event: "ready"; payload: null }
  | { type: "PENALTY444_UNITY_EVENT"; event: "animation_complete"; payload: { round: number } }
  | { type: "PENALTY444_UNITY_EVENT"; event: "error"; payload: { message: string } };

// ─── Inbound message validation (Unity → React) ──────────────────────────────

/**
 * Validate a raw `postMessage` payload claimed to come from the Unity build.
 * Accepts ONLY `type: "PENALTY444_UNITY_EVENT"` with one of the three known
 * events and a well-formed payload. Returns null (silently ignored) otherwise.
 * Origin must be checked by the caller before invoking this.
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
      return { type: "PENALTY444_UNITY_EVENT", event: "error", payload: { message } };
    }
    default:
      return null; // unknown event → silently ignore
  }
}

/**
 * Phase B2 helper (defined now, used later): post an authoritative match event
 * INTO the Unity iframe. It only forwards already-resolved state; it never
 * computes outcomes. Not invoked anywhere in Phase B1.
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
   * Optional Unity → React event callbacks. Wired by the live match page in
   * Phase B2; harmless no-ops here. The renderer never derives match outcome
   * from these — they only drive presentation/animation timing.
   */
  onReady?: () => void;
  onAnimationComplete?: (round: number) => void;
  onError?: (message: string) => void;
};

export default function MatchRenderer3D({
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

  useEffect(() => {
    // Only listen when there is actually an iframe build to listen to.
    if (!enabled || !buildUrl) return;

    function handleMessage(event: MessageEvent) {
      // Same-origin only. A cross-origin/CDN build must be served from this
      // origin (plan §7) for its messages to be accepted.
      if (event.origin !== window.location.origin) return;

      const msg = validateUnityMessage(event.data);
      if (!msg) return;

      const cb = callbacksRef.current;
      if (msg.event === "ready") cb.onReady?.();
      else if (msg.event === "animation_complete") {
        cb.onAnimationComplete?.(msg.payload.round);
      } else if (msg.event === "error") cb.onError?.(msg.payload.message);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [enabled, buildUrl]);

  // Flag off → render nothing. Guarantees zero footprint on the live build.
  if (!enabled) return null;

  // Enabled but no build configured → safe internal placeholder (never shown to
  // users in Phase B1 because this component is not mounted anywhere live).
  if (!buildUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-dashed border-[#1B2433] bg-[#0D1420] px-4 py-8 text-center"
        aria-label="3D match renderer placeholder"
      >
        <div>
          <p className="text-sm font-bold text-zinc-300">3D match renderer</p>
          <p className="mt-1 text-xs text-zinc-500">
            Enabled, but NEXT_PUBLIC_UNITY_BUILD_URL is not configured. Phase B2
            wires the live Unity build.
          </p>
        </div>
      </div>
    );
  }

  // Enabled + build URL present → passive iframe shell. Phase B2 finalizes the
  // Unity loader, the React→Unity send path, and the DOM fallback wiring. This
  // shell holds NO sockets, NO auth, and forwards NO match-control input.
  return (
    <iframe
      ref={iframeRef}
      src={buildUrl}
      title="Penalty444 3D match renderer"
      className="h-full w-full rounded-2xl border border-[#1B2433] bg-black"
      allow="autoplay; fullscreen"
    />
  );
}
