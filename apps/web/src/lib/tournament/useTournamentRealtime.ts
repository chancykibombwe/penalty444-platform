"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSocket } from "../socket/client";
import { supabase } from "../supabase/client";

export type TournamentMatchReadyPayload = {
  tournamentId: string;
  tournamentMatchId: string;
  roomCode: string;
  autoRouteInMs: number;
};

export type PendingMatchReady = TournamentMatchReadyPayload & {
  redirectAt: number;
};

type UseTournamentRealtimeOptions = {
  tournamentId?: string | null;
  playerId?: string | null;
  /**
   * Fallback "match is ready" derived from fetched DB rows. The hook activates
   * it after a short delay if no realtime `tournament:matchReady` was received
   * for the same tournament. Lets the auto-enter banner / countdown still fire
   * when the socket event is missed.
   */
  fallbackReady?: {
    tournamentId: string;
    tournamentMatchId: string;
    roomCode: string;
  } | null;
  /** Delay before promoting fallback → pending. */
  fallbackActivateAfterMs?: number;
};

type UseTournamentRealtimeResult = {
  pendingMatchReady: PendingMatchReady | null;
  matchReadyCountdown: number | null;
  enterPendingMatchNow: () => void;
};

const DEFAULT_FALLBACK_ACTIVATE_AFTER_MS = 3_500;
const DEFAULT_FALLBACK_AUTO_ROUTE_IN_MS = 4_000;

export function useTournamentRealtime({
  tournamentId,
  playerId,
  fallbackReady = null,
  fallbackActivateAfterMs = DEFAULT_FALLBACK_ACTIVATE_AFTER_MS,
}: UseTournamentRealtimeOptions): UseTournamentRealtimeResult {
  const router = useRouter();
  const pathname = usePathname();
  const [pendingMatchReady, setPendingMatchReady] =
    useState<PendingMatchReady | null>(null);
  const [matchReadyCountdown, setMatchReadyCountdown] = useState<number | null>(
    null
  );
  const autoRouteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Most recent `tournamentMatchId` we received over the realtime socket. We
   * keep this so the fallback path can skip if a live event has already taken
   * over (or already routed the user).
   */
  const realtimeMatchReadyMatchIdRef = useRef<string | null>(null);
  /** Track which fallback id we've already armed to avoid duplicate timers. */
  const fallbackArmedForMatchIdRef = useRef<string | null>(null);

  const isOnMatchRoute = pathname?.startsWith("/match/") ?? false;

  const clearAutoRouteTimeout = useCallback(() => {
    if (autoRouteTimeoutRef.current) {
      clearTimeout(autoRouteTimeoutRef.current);
      autoRouteTimeoutRef.current = null;
    }
  }, []);

  const navigateToPendingMatch = useCallback(
    (pending: PendingMatchReady) => {
      clearAutoRouteTimeout();
      setPendingMatchReady(null);
      setMatchReadyCountdown(null);
      router.push(`/match/${pending.roomCode}`);
    },
    [clearAutoRouteTimeout, router]
  );

  const enterPendingMatchNow = useCallback(() => {
    if (!pendingMatchReady) {
      return;
    }

    navigateToPendingMatch(pendingMatchReady);
  }, [navigateToPendingMatch, pendingMatchReady]);

  useEffect(() => {
    if (!pendingMatchReady) {
      setMatchReadyCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const secondsLeft = Math.max(
        0,
        Math.ceil((pendingMatchReady.redirectAt - Date.now()) / 1000)
      );
      setMatchReadyCountdown(secondsLeft);
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pendingMatchReady]);

  useEffect(() => {
    if (!pendingMatchReady || isOnMatchRoute) {
      clearAutoRouteTimeout();
      return;
    }

    const delayMs = Math.max(0, pendingMatchReady.redirectAt - Date.now());

    clearAutoRouteTimeout();
    autoRouteTimeoutRef.current = setTimeout(() => {
      navigateToPendingMatch(pendingMatchReady);
    }, delayMs);

    return clearAutoRouteTimeout;
  }, [
    pendingMatchReady,
    isOnMatchRoute,
    clearAutoRouteTimeout,
    navigateToPendingMatch,
  ]);

  useEffect(() => {
    if (!playerId) {
      return;
    }

    const trimmedPlayerId = playerId.trim();
    if (!trimmedPlayerId) {
      return;
    }

    const trimmedTournamentId =
      typeof tournamentId === "string" ? tournamentId.trim() : "";

    const socket = getSocket();

    let cancelled = false;

    /**
     * Sprint 6 — TASK 4 + TASK 5: verify the Supabase session before
     * we emit identity-bearing events. In enforce mode the realtime
     * server REJECTS:
     *   - `player:register` whose payload `playerId` does not match
     *     `socket.data.userId` (the verified Supabase user id).
     *   - `tournament:subscribe` from sockets without a verified user.
     *
     * Holding the emit until we've confirmed a live session avoids
     * spurious rejection logs and keeps anonymous viewers safely
     * silent (they still receive any public broadcasts the server
     * decides to send).
     */
    const registerAndSubscribe = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;

      const sessionUserId = session?.user?.id ?? null;

      // Mismatch or anonymous viewer — do NOT emit authenticated
      // events. Tournament UI can still render publicly available
      // bracket data via REST.
      if (!sessionUserId || sessionUserId !== trimmedPlayerId) {
        if (process.env.NODE_ENV !== "production") {
          console.info(
            "[socket-auth] skipping player:register / tournament:subscribe — no matching session"
          );
        }
        return;
      }

      socket.emit("player:register", { playerId: trimmedPlayerId });

      if (trimmedTournamentId) {
        socket.emit("tournament:subscribe", {
          tournamentId: trimmedTournamentId,
        });
      }
    };

    const unsubscribeTournament = () => {
      if (trimmedTournamentId && socket.connected) {
        // Best-effort unsubscribe — the server tolerates duplicate /
        // unknown unsubscribe calls. We do not gate this on auth: if
        // the socket reached the server it can clean its room map.
        socket.emit("tournament:unsubscribe", {
          tournamentId: trimmedTournamentId,
        });
      }
    };

    const onMatchReady = (payload: TournamentMatchReadyPayload) => {
      if (
        trimmedTournamentId &&
        payload.tournamentId !== trimmedTournamentId
      ) {
        return;
      }

      if (!payload.roomCode?.trim()) {
        return;
      }

      const autoRouteInMs =
        typeof payload.autoRouteInMs === "number" && payload.autoRouteInMs >= 0
          ? payload.autoRouteInMs
          : 3000;

      console.info(
        "[AutoRouteFallback] realtime matchReady received",
        payload.tournamentMatchId,
        "room=",
        payload.roomCode
      );

      realtimeMatchReadyMatchIdRef.current = payload.tournamentMatchId;
      fallbackArmedForMatchIdRef.current = null;

      setPendingMatchReady({
        tournamentId: payload.tournamentId,
        tournamentMatchId: payload.tournamentMatchId,
        roomCode: payload.roomCode.trim(),
        autoRouteInMs,
        redirectAt: Date.now() + autoRouteInMs,
      });
    };

    if (socket.connected) {
      void registerAndSubscribe();
    }

    const onConnect = () => {
      void registerAndSubscribe();
    };

    socket.on("connect", onConnect);
    socket.on("tournament:matchReady", onMatchReady);

    // TOKEN_REFRESHED / SIGNED_IN inside `lib/socket/client.ts` already
    // bounces the socket (disconnect → connect), which fires `connect`
    // and re-triggers the gated `registerAndSubscribe` path above.

    return () => {
      cancelled = true;
      socket.off("connect", onConnect);
      socket.off("tournament:matchReady", onMatchReady);
      unsubscribeTournament();
      clearAutoRouteTimeout();
    };
  }, [
    tournamentId,
    playerId,
    clearAutoRouteTimeout,
  ]);

  // Fallback: if fetched DB rows say the player has a non-terminal match with
  // a `room_code` but no realtime ready has fired, promote the fallback to a
  // pending match-ready after a short delay. Lets dropped/missed events
  // recover transparently.
  useEffect(() => {
    if (!fallbackReady) {
      fallbackArmedForMatchIdRef.current = null;
      return;
    }

    if (isOnMatchRoute) {
      return;
    }

    // If realtime already covers this exact match id, skip the fallback.
    if (
      realtimeMatchReadyMatchIdRef.current === fallbackReady.tournamentMatchId
    ) {
      return;
    }

    if (
      pendingMatchReady &&
      pendingMatchReady.tournamentMatchId === fallbackReady.tournamentMatchId
    ) {
      return;
    }

    if (
      fallbackArmedForMatchIdRef.current === fallbackReady.tournamentMatchId
    ) {
      return;
    }

    fallbackArmedForMatchIdRef.current = fallbackReady.tournamentMatchId;

    console.info(
      "[AutoRouteFallback] arming fallback for",
      fallbackReady.tournamentMatchId,
      "room=",
      fallbackReady.roomCode,
      "delay=",
      fallbackActivateAfterMs
    );

    const timeoutId = window.setTimeout(() => {
      // Re-check just before promotion in case a realtime event arrived.
      if (
        realtimeMatchReadyMatchIdRef.current === fallbackReady.tournamentMatchId
      ) {
        return;
      }

      console.info(
        "[AutoRouteFallback] activating fallback for",
        fallbackReady.tournamentMatchId
      );

      setPendingMatchReady({
        tournamentId: fallbackReady.tournamentId,
        tournamentMatchId: fallbackReady.tournamentMatchId,
        roomCode: fallbackReady.roomCode.trim(),
        autoRouteInMs: DEFAULT_FALLBACK_AUTO_ROUTE_IN_MS,
        redirectAt: Date.now() + DEFAULT_FALLBACK_AUTO_ROUTE_IN_MS,
      });
    }, fallbackActivateAfterMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    fallbackReady,
    fallbackActivateAfterMs,
    isOnMatchRoute,
    pendingMatchReady,
  ]);

  return {
    pendingMatchReady,
    matchReadyCountdown,
    enterPendingMatchNow,
  };
}
