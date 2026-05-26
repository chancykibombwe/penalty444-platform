"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";

/**
 * Global "Match Ready" overlay for the absent player.
 *
 * Mounted at the app root (next to `ActiveMatchRecovery`). Listens for
 * the server's `match:returnRequested` event — emitted only when the
 * opponent has arrived on the match page but the local player is NOT
 * present (typically because they navigated back to `/lobby` after
 * creating the room). Displays a non-dismissable modal with a live
 * deadline countdown and a single "Join now" CTA that routes to
 * `/match/<code>`.
 *
 * Automatically dismisses when:
 *   - the server emits `match:cancelled` (window expired or otherwise),
 *   - the local user navigates to the same `/match/<code>`,
 *   - the deadline elapses client-side (defensive — the server should
 *     drive the final dismissal).
 *
 * Presentation-only. The server is the authority on whether the
 * window is still open; this component just renders the latest known
 * state.
 */
type ReturnRequestedPayload = {
  roomCode?: string;
  expiresAt?: number;
  opponentName?: string | null;
};

type MatchCancelledPayload = {
  roomCode?: string;
  reason?: string;
  message?: string;
};

type ReadyState = {
  roomCode: string;
  expiresAt: number;
  opponentName: string | null;
};

export default function MatchReadyNotification() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<ReadyState | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  // Keeps the latest state accessible to socket handlers without
  // putting them in the effect dep list (avoids reattaching listeners
  // on every state change).
  const stateRef = useRef<ReadyState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    const socket = getSocket();

    function onReturnRequested(data: ReturnRequestedPayload) {
      if (typeof data.roomCode !== "string" || data.roomCode.trim().length === 0) {
        return;
      }
      if (typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) {
        return;
      }
      const code = data.roomCode.trim().toUpperCase();
      setState({
        roomCode: code,
        expiresAt: data.expiresAt,
        opponentName:
          typeof data.opponentName === "string" && data.opponentName.trim()
            ? data.opponentName.trim()
            : null,
      });
    }

    function onMatchCancelled(data: MatchCancelledPayload) {
      const current = stateRef.current;
      if (!current) return;
      if (typeof data.roomCode === "string") {
        const code = data.roomCode.trim().toUpperCase();
        if (code !== current.roomCode) return;
      }
      setState(null);
      setSecondsRemaining(null);
    }

    socket.on("match:returnRequested", onReturnRequested);
    socket.on("match:cancelled", onMatchCancelled);

    return () => {
      socket.off("match:returnRequested", onReturnRequested);
      socket.off("match:cancelled", onMatchCancelled);
    };
  }, []);

  // Auto-dismiss once the local user is already on the target match
  // page. The MatchRoomPanel's own overlay takes over from here.
  useEffect(() => {
    if (!state) return;
    if (!pathname) return;
    if (pathname === `/match/${state.roomCode}`) {
      setState(null);
      setSecondsRemaining(null);
    }
  }, [pathname, state]);

  // 1Hz drift-correcting countdown. Mirrors the MatchRoomPanel ticker.
  useEffect(() => {
    if (!state) {
      setSecondsRemaining(null);
      return;
    }

    function tick() {
      const remaining = Math.max(
        0,
        Math.ceil(((state?.expiresAt ?? 0) - Date.now()) / 1000)
      );
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        // Client-side safety net — server will also emit `match:cancelled`
        // when the window expires. Whichever fires first wins; both
        // converge on the same dismissed state.
        setState(null);
      }
    }

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [state]);

  if (!state) return null;
  if (secondsRemaining === null) return null;

  function handleJoin() {
    if (!state) return;
    router.push(`/match/${state.roomCode}`);
    setState(null);
    setSecondsRemaining(null);
  }

  return (
    <>
      {/* Inlined keyframes — `MATCH_PRESENTATION_CSS` is only injected
          while `MatchRoomPanel` is mounted, but this notification can
          appear at `/lobby` (or any other route) where those keyframes
          aren't defined. Keeping the surface minimal: just the four
          animations this component actually uses. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes p444ReadyFadeIn{0%{opacity:0}100%{opacity:1}}" +
            "@keyframes p444ReadyCardIn{0%{opacity:0;transform:translateY(8px) scale(0.98)}60%{opacity:1;transform:translateY(0) scale(1.005)}100%{opacity:1;transform:translateY(0) scale(1)}}" +
            "@keyframes p444ReadyPulse{0%,100%{opacity:0.55;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}" +
            "@keyframes p444ReadyDigit{0%{opacity:0;transform:scale(0.62)}28%{opacity:1;transform:scale(1.1)}72%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}" +
            ".p444-ready-backdrop{animation:p444ReadyFadeIn 0.28s ease-out forwards}" +
            ".p444-ready-card{animation:p444ReadyCardIn 0.42s cubic-bezier(0.22,1,0.36,1) forwards}" +
            ".p444-ready-ring{animation:p444ReadyPulse 2s ease-in-out infinite}" +
            ".p444-ready-digit{animation:p444ReadyDigit 0.9s ease-out forwards}",
        }}
      />
      <div
        className="p444-ready-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-md"
        role="alertdialog"
        aria-live="assertive"
        aria-label="Match ready — join now"
      >
        <div className="p444-ready-card w-full max-w-md rounded-3xl border border-emerald-400/55 bg-zinc-950/95 px-6 py-8 text-center shadow-2xl shadow-[0_0_44px_rgba(16,185,129,0.32)] sm:px-8 sm:py-10">
          <span
            className="p444-ready-ring inline-flex h-3 w-3 rounded-full bg-emerald-300"
            aria-hidden
          />
          <p className="mt-4 text-[11px] font-black uppercase tracking-[0.32em] text-emerald-300/95">
            Match Ready
          </p>
          <h2 className="mt-2 break-words text-3xl font-black text-white sm:text-4xl">
            {state.opponentName
              ? `${state.opponentName} is waiting`
              : "Your opponent is waiting"}
          </h2>
          <p className="mt-3 text-sm text-zinc-400 sm:text-base">
            Room{" "}
            <span className="font-mono font-bold text-white">{state.roomCode}</span>{" "}
            is ready. Join now to start the match.
          </p>

          <div className="mt-7">
            <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-zinc-500">
              Auto-cancels in
            </p>
            <p
              key={secondsRemaining}
              className="p444-ready-digit mt-2 text-[5rem] font-black tabular-nums leading-none text-emerald-200 drop-shadow-[0_0_24px_rgba(16,185,129,0.55)] sm:text-[6rem]"
            >
              {secondsRemaining}s
            </p>
          </div>

          <button
            type="button"
            onClick={handleJoin}
            className="mt-6 w-full rounded-2xl border border-emerald-300/70 bg-emerald-500/20 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-emerald-50 transition-colors hover:bg-emerald-500/30"
          >
            Join now
          </button>
          <p className="mt-3 text-[11px] text-zinc-500">
            If you don't return in time, the match is cancelled — no penalty.
          </p>
        </div>
      </div>
    </>
  );
}
