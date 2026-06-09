"use client";

/**
 * Global tournament match-ready overlay.
 *
 * Mounted in RootLayout alongside MatchReadyNotification so registered
 * tournament players receive the `tournament:matchReady` notification on
 * any route — Home, Lobby, Leaderboard, Account, etc.
 *
 * Tournament routes (/tournaments, /tournaments/[id]) already mount
 * useTournamentRealtime and render their own match-ready UI; we suppress
 * this overlay there to avoid duplicate notifications.
 *
 * No dismiss: consistent with the auto-route behaviour of useTournamentRealtime.
 * No DB fallback: the existing /tournaments/[id] fallback is unchanged.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { useTournamentRealtime } from "../../lib/tournament/useTournamentRealtime";

const MODAL_CSS = `
@keyframes p444TReadyFadeIn {
  from { opacity: 0; backdrop-filter: blur(0); }
  to   { opacity: 1; backdrop-filter: blur(8px); }
}
@keyframes p444TReadyCardIn {
  0%   { opacity: 0; transform: translateY(16px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes p444TReadyPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.45); }
  50%      { box-shadow: 0 0 0 14px rgba(251, 191, 36, 0); }
}
.p444-tready-overlay {
  animation: p444TReadyFadeIn 220ms ease-out forwards;
}
.p444-tready-card {
  animation: p444TReadyCardIn 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.p444-tready-cta {
  animation: p444TReadyPulse 1800ms ease-in-out infinite;
}
`;

export default function TournamentMatchReadyNotification() {
  const pathname = usePathname();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCurrentPlayerIdentity().then((identity) => {
      if (!cancelled) {
        setCurrentUserId(identity?.playerId ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { pendingMatchReady, matchReadyCountdown, enterPendingMatchNow } =
    useTournamentRealtime({ playerId: currentUserId });

  // /tournaments and /tournaments/[id] already handle tournament:matchReady
  // via their own useTournamentRealtime mount. Suppress here to prevent
  // a duplicate overlay on top of the in-page waiting-room banner.
  if (pathname?.startsWith("/tournaments")) return null;
  if (!pendingMatchReady) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MODAL_CSS }} />
      <div
        className="p444-tready-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-6"
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
      >
        <div className="p444-tready-card w-full max-w-sm rounded-3xl border border-amber-400/40 bg-zinc-950/95 px-6 py-7 text-center shadow-2xl">
          <p className="text-[10px] font-black uppercase tracking-[0.34em] text-amber-300/90">
            Tournament match ready
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">Enter match</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Your tournament match is ready.
          </p>
          {pendingMatchReady.roomCode ? (
            <p className="mt-3 select-all text-2xl font-black tracking-[0.36em] text-white/95">
              {pendingMatchReady.roomCode}
            </p>
          ) : null}
          <p className="mt-3 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            Auto-entering in
          </p>
          <p className="mt-1 text-5xl font-black tabular-nums text-white">
            {matchReadyCountdown ?? "—"}s
          </p>
          <button
            type="button"
            onClick={enterPendingMatchNow}
            className="p444-tready-cta mt-5 w-full rounded-2xl bg-amber-500 px-5 py-3 text-base font-black uppercase tracking-[0.22em] text-zinc-950 transition hover:bg-amber-400"
          >
            Enter Match
          </button>
        </div>
      </div>
    </>
  );
}
