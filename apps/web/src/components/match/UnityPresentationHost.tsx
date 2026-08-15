"use client";

/**
 * B6D3B PR-2 — isolated player-facing Unity host (presentation-only, default-off).
 *
 * The host owns ONLY the presentation lifecycle. It never touches gameplay state:
 * no sockets, no picks, no timers, no scores, no reveal timing, no match
 * authority. React remains the authoritative renderer and state owner; Unity is a
 * decorative view that may cover the arena artwork and nothing else.
 *
 * Fail-open by construction: the React underlay supplied as `children` stays
 * MOUNTED in every state. When Unity becomes ready the underlay is only made
 * visually transparent — never unmounted — so a failure at any moment reveals the
 * live React arena instantly with no gameplay interruption and no error card.
 *
 * Controls, scoreboard, timer, status, disconnect UI, result text and all
 * accessibility content live OUTSIDE this host, above the presentation layer.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import MatchRenderer3D from "./MatchRenderer3D";
import type { SentSummary } from "./unityPresentationShadow";
import type { PresentationEnvelope } from "./unityPresentationProtocol";
import type { ViewerIdentityContext } from "./unityPresentationIdentity";
import type { CorrelationSummary } from "./unityPresentationCorrelation";

export type HostState =
  | "REACT_ONLY"
  | "UNITY_LOADING"
  | "UNITY_READY_VISIBLE"
  | "UNITY_FAILED_REACT_FALLBACK";

/** Per-instance lifecycle memory. Failure is terminal for its own instance only. */
export interface HostRuntimeState {
  readonly readyInstanceId: string | null;
  readonly failedInstanceId: string | null;
}

export const INITIAL_HOST_RUNTIME: HostRuntimeState = Object.freeze({
  readyInstanceId: null,
  failedInstanceId: null,
});

/**
 * Pure state resolution — exported so the whole lifecycle is unit-testable with
 * `node:test` and no React testing dependency.
 *
 * A failed instance never resurrects; a DIFFERENT `matchInstanceId` starts fresh
 * because readiness/failure are both recorded per instance.
 */
export function computeHostState(args: {
  playerFacingAuthorized: boolean;
  matchInstanceId: string | null;
  identityInstanceId: string | null;
  runtime: HostRuntimeState;
}): HostState {
  const { playerFacingAuthorized, matchInstanceId, identityInstanceId, runtime } = args;
  if (!playerFacingAuthorized) return "REACT_ONLY";
  if (typeof matchInstanceId !== "string" || matchInstanceId.length === 0) return "REACT_ONLY";
  // Sanitized identity must exist AND belong to the active instance.
  if (identityInstanceId !== matchInstanceId) return "REACT_ONLY";
  if (runtime.failedInstanceId === matchInstanceId) return "UNITY_FAILED_REACT_FALLBACK";
  if (runtime.readyInstanceId === matchInstanceId) return "UNITY_READY_VISIBLE";
  return "UNITY_LOADING";
}

/** The renderer is mounted only while loading or ready — never after a failure. */
export function shouldMountRenderer(state: HostState): boolean {
  return state === "UNITY_LOADING" || state === "UNITY_READY_VISIBLE";
}

export interface UnityPresentationHostProps {
  playerFacingAuthorized: boolean;
  matchInstanceId: string | null;
  messages: ReadonlyArray<{ id: string; message: PresentationEnvelope }>;
  identity: ViewerIdentityContext | null;
  correlation: CorrelationSummary | null;
  onReady: () => void;
  onError: (reason: string) => void;
  onMessageSent: (summary: SentSummary) => void;
  children: React.ReactNode;
  /**
   * Optional presentation-only ready timeout override forwarded to
   * `MatchRenderer3D`. Omit to preserve the renderer default (15s). The host is
   * not authoritative for timing — it only threads the bound through.
   */
  readyTimeoutMs?: number;
  testHooks?: {
    forceState?: HostState;
  };
}

/** Invoke an external callback so a throwing consumer can never break the match. */
function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    /* external callback errors are contained */
  }
}

export default function UnityPresentationHost({
  playerFacingAuthorized,
  matchInstanceId,
  messages,
  identity,
  correlation,
  onReady,
  onError,
  onMessageSent,
  children,
  readyTimeoutMs,
  testHooks,
}: UnityPresentationHostProps) {
  const [runtime, setRuntime] = useState<HostRuntimeState>(INITIAL_HOST_RUNTIME);
  // Latest callbacks in a ref so the renderer handlers stay stable.
  const cbRef = useRef({ onReady, onError, onMessageSent });
  cbRef.current = { onReady, onError, onMessageSent };
  // One ready/error notification per instance lifecycle.
  const notifiedReadyRef = useRef<string | null>(null);
  const notifiedErrorRef = useRef<string | null>(null);

  // A new match instance clears any prior terminal failure for the host.
  const lastInstanceRef = useRef<string | null>(matchInstanceId);
  useEffect(() => {
    if (lastInstanceRef.current === matchInstanceId) return;
    lastInstanceRef.current = matchInstanceId;
    notifiedReadyRef.current = null;
    notifiedErrorRef.current = null;
    setRuntime(INITIAL_HOST_RUNTIME);
  }, [matchInstanceId]);

  const handleReady = useCallback(() => {
    const instance = lastInstanceRef.current;
    if (instance === null) return;
    setRuntime((prev) =>
      // Never resurrect a failed instance.
      prev.failedInstanceId === instance ? prev : { ...prev, readyInstanceId: instance },
    );
    if (notifiedReadyRef.current === instance) return;
    notifiedReadyRef.current = instance;
    safeCall(cbRef.current.onReady);
  }, []);

  const handleError = useCallback((reason: string) => {
    const instance = lastInstanceRef.current;
    if (instance === null) return;
    setRuntime((prev) => ({ ...prev, failedInstanceId: instance, readyInstanceId: null }));
    if (notifiedErrorRef.current === instance) return;
    notifiedErrorRef.current = instance;
    const cb = cbRef.current.onError;
    if (!cb) return;
    try {
      cb(reason);
    } catch {
      /* external callback errors are contained */
    }
  }, []);

  const handleMessageSent = useCallback((summary: SentSummary) => {
    const cb = cbRef.current.onMessageSent;
    if (!cb) return;
    try {
      cb(summary);
    } catch {
      /* external callback errors are contained */
    }
  }, []);

  const resolved = computeHostState({
    playerFacingAuthorized,
    matchInstanceId,
    identityInstanceId: identity === null ? null : identity.matchInstanceId,
    runtime,
  });
  const state: HostState = testHooks?.forceState ?? resolved;
  const mountRenderer = shouldMountRenderer(state);
  const unityVisible = state === "UNITY_READY_VISIBLE";

  // `correlation` is accepted for future presentation use; it is deliberately not
  // rendered and never influences gameplay.
  void correlation;

  return (
    <div className="relative h-full w-full" data-unity-host="" data-host-state={state}>
      {/*
        Decorative React underlay. ALWAYS mounted — in every state — so a Unity
        failure exposes it immediately. When Unity is visible it is only made
        transparent. It is decorative, so it never owns accessibility content.
      */}
      <div
        data-unity-underlay=""
        aria-hidden="true"
        className={`h-full w-full transition-opacity duration-200 ${
          unityVisible ? "opacity-0" : "opacity-100"
        }`}
      >
        {children}
      </div>

      {mountRenderer ? (
        <div data-unity-slot="" className="pointer-events-none absolute inset-0">
          <MatchRenderer3D
            messages={messages}
            deliveryMode="fifo"
            activeMatchInstanceId={matchInstanceId}
            presentationOnly
            readyTimeoutMs={readyTimeoutMs}
            onReady={handleReady}
            onError={handleError}
            onMessageSent={handleMessageSent}
          />
        </div>
      ) : null}
    </div>
  );
}
