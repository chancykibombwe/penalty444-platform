"use client";

/**
 * Phase 6C — Match Ready notification.
 *
 * Listens (globally, mounted in `RootLayout`) for the readiness
 * authority's `match:opponentReady` event. The event is emitted
 * directly to the absent player's last-known socket: it arrives even
 * when the player has navigated back to `/lobby`, because the server
 * uses the socketId rather than the room channel.
 *
 * Renders a non-dismissible modal with:
 *   • opponent's name (if available)
 *   • room code
 *   • a 10s countdown
 *   • a primary "Join now" CTA routing to `/match/[roomCode]`
 *
 * If the countdown expires before the player clicks, the modal
 * silently dismisses. The server-side readiness authority will
 * already have cancelled the room (for non-tournament matches) and
 * emitted `match:cancelled` to any present clients.
 *
 * Inlined CSS — this component renders OUTSIDE the match page where
 * `MATCH_PRESENTATION_CSS` is not loaded. Keep these keyframes
 * self-contained so the animation works on every route.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";

type OpponentReadyPayload = {
  roomCode?: string;
  expiresAt?: number;
  opponentName?: string | null;
};

type ReadyState = {
  roomCode: string;
  expiresAt: number;
  opponentName: string | null;
};

const READY_NOTIFICATION_CSS = `
@keyframes p444ReadyFadeIn {
  from { opacity: 0; backdrop-filter: blur(0); }
  to   { opacity: 1; backdrop-filter: blur(8px); }
}
@keyframes p444ReadyCardIn {
  0%   { opacity: 0; transform: translateY(16px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes p444ReadyPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
  50%      { box-shadow: 0 0 0 14px rgba(16, 185, 129, 0); }
}
.p444-ready-overlay {
  animation: p444ReadyFadeIn 220ms ease-out forwards;
}
.p444-ready-card {
  animation: p444ReadyCardIn 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.p444-ready-cta {
  animation: p444ReadyPulse 1800ms ease-in-out infinite;
}
`;

export default function MatchReadyNotification() {
  const router = useRouter();
  const [state, setState] = useState<ReadyState | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const dismissTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const socket = getSocket();

    function onOpponentReady(payload: OpponentReadyPayload) {
      if (
        typeof payload?.roomCode !== "string" ||
        typeof payload?.expiresAt !== "number"
      ) {
        return;
      }

      setState({
        roomCode: payload.roomCode.trim().toUpperCase(),
        expiresAt: payload.expiresAt,
        opponentName: payload.opponentName ?? null,
      });
    }

    function onCancelled(payload: { roomCode?: string }) {
      // Server torn down the room — the notification is no longer
      // actionable, dismiss whatever was showing.
      if (
        state &&
        typeof payload?.roomCode === "string" &&
        payload.roomCode.trim().toUpperCase() === state.roomCode
      ) {
        setState(null);
      } else if (!state) {
        // Defensive: if we'd never actually shown a notification we
        // still want to be ready to dismiss any racing state-set.
        setState(null);
      }
    }

    socket.on("match:opponentReady", onOpponentReady);
    socket.on("match:cancelled", onCancelled);

    return () => {
      socket.off("match:opponentReady", onOpponentReady);
      socket.off("match:cancelled", onCancelled);
    };
    // We intentionally depend on `state` so the cancel handler sees
    // the latest in-scope room. Re-binding on every change is cheap
    // and avoids a ref dance.
  }, [state]);

  useEffect(() => {
    if (!state) {
      setSecondsRemaining(null);
      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
      return;
    }

    const tick = () => {
      const remainingMs = state.expiresAt - Date.now();
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsRemaining(seconds);
      if (remainingMs <= 0) {
        // Countdown expired locally — the server will have already
        // cancelled non-tournament rooms by now, just hide.
        setState(null);
      }
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [state]);

  if (!state) return null;

  const handleJoin = () => {
    const code = state.roomCode;
    setState(null);
    router.push(`/match/${encodeURIComponent(code)}`);
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: READY_NOTIFICATION_CSS }} />
      <div
        className="p444-ready-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-6"
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
      >
        <div className="p444-ready-card w-full max-w-sm rounded-3xl border border-emerald-400/40 bg-zinc-950/95 px-6 py-7 text-center shadow-2xl">
          <p className="text-[10px] font-black uppercase tracking-[0.34em] text-emerald-300/90">
            Match ready
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">
            Join now
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            {state.opponentName
              ? `${state.opponentName} is waiting in your match.`
              : "Your opponent is waiting in the match."}
          </p>
          <p className="mt-3 select-all text-2xl font-black tracking-[0.36em] text-white/95">
            {state.roomCode}
          </p>
          <p className="mt-3 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            Returning in
          </p>
          <p className="mt-1 text-5xl font-black tabular-nums text-white">
            {secondsRemaining ?? "—"}s
          </p>
          <button
            type="button"
            onClick={handleJoin}
            className="p444-ready-cta mt-5 w-full rounded-2xl bg-emerald-500 px-5 py-3 text-base font-black uppercase tracking-[0.22em] text-zinc-950 transition hover:bg-emerald-400"
          >
            Join match
          </button>
          <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
            No penalty if missed
          </p>
        </div>
      </div>
    </>
  );
}
