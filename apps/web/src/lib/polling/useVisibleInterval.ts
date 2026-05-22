"use client";

/**
 * Hardening Sprint 2 — TASK 3 + 5: visibility-aware polling primitive.
 *
 * Replaces ad-hoc `setInterval` blocks across the live ecosystem with a
 * single hook that:
 *
 *   - Runs `tick` once on mount.
 *   - Schedules `tick` every `intervalMs` while the tab is visible.
 *   - Pauses the interval when the tab is hidden.
 *   - Immediately runs `tick` again when the tab becomes visible.
 *   - Cancels everything on unmount / dependency change.
 *
 * Calls to `tick` are serialised — if a tick is still running when the
 * timer fires, the new tick is skipped to avoid stampeding requests.
 *
 * The hook returns a stable `refresh` callback that you can wire into a
 * "manual refresh" button or imperative caller.
 */

import { useCallback, useEffect, useRef } from "react";

type TickFn = (signal: AbortSignal) => Promise<void> | void;

export type UseVisibleIntervalOptions = {
  /** Active polling interval in ms. */
  intervalMs: number;
  /**
   * When true, the hook is dormant — no ticks fire and no listeners are
   * installed. Useful for "match completed → stop polling" surfaces
   * without remounting.
   */
  paused?: boolean;
  /** If false, the initial mount tick is suppressed. Defaults to true. */
  runImmediately?: boolean;
  /**
   * Stable dependency list. When any item changes, the previous tick
   * loop is torn down and a fresh one starts. Mirrors React's useEffect
   * dep array semantics.
   */
  deps?: ReadonlyArray<unknown>;
};

export function useVisibleInterval(
  tick: TickFn,
  {
    intervalMs,
    paused = false,
    runImmediately = true,
    deps = [],
  }: UseVisibleIntervalOptions
): { refresh: () => void } {
  // Keep the latest tick fn in a ref so we never need to add it to the
  // effect dep array (which would tear down the interval on every render).
  const tickRef = useRef<TickFn>(tick);
  tickRef.current = tick;

  const inFlightRef = useRef(false);
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (paused) return;

    let cancelled = false;
    let controller: AbortController | null = null;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    async function runTick(reason: string) {
      if (cancelled) return;
      if (inFlightRef.current) {
        // Skip overlapping ticks — keeps Supabase hot pool predictable.
        return;
      }
      inFlightRef.current = true;
      controller?.abort();
      controller = new AbortController();
      try {
        await tickRef.current(controller.signal);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[Polling] tick crashed (${reason}):`, error);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    function startInterval() {
      if (intervalHandle !== null) return;
      intervalHandle = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void runTick("interval");
      }, intervalMs);
    }

    function stopInterval() {
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    }

    function onVisibilityChange() {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        stopInterval();
        return;
      }
      // Resumed: run an immediate tick then restart the interval.
      void runTick("visibility-resume");
      startInterval();
    }

    if (runImmediately) {
      void runTick("mount");
    }

    if (typeof document === "undefined" || !document.hidden) {
      startInterval();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    refreshRef.current = () => void runTick("manual");

    return () => {
      cancelled = true;
      controller?.abort();
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      refreshRef.current = null;
    };
    // The deps array is intentionally caller-controlled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, paused, runImmediately, ...deps]);

  const refresh = useCallback(() => {
    refreshRef.current?.();
  }, []);

  return { refresh };
}
