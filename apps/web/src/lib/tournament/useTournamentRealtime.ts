"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSocket } from "../socket/client";

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
};

type UseTournamentRealtimeResult = {
  pendingMatchReady: PendingMatchReady | null;
  matchReadyCountdown: number | null;
  enterPendingMatchNow: () => void;
};

export function useTournamentRealtime({
  tournamentId,
  playerId,
}: UseTournamentRealtimeOptions): UseTournamentRealtimeResult {
  const router = useRouter();
  const pathname = usePathname();
  const [pendingMatchReady, setPendingMatchReady] =
    useState<PendingMatchReady | null>(null);
  const [matchReadyCountdown, setMatchReadyCountdown] = useState<number | null>(
    null
  );
  const autoRouteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const registerAndSubscribe = () => {
      socket.emit("player:register", { playerId: trimmedPlayerId });

      if (trimmedTournamentId) {
        socket.emit("tournament:subscribe", {
          tournamentId: trimmedTournamentId,
        });
      }
    };

    const unsubscribeTournament = () => {
      if (trimmedTournamentId) {
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

      setPendingMatchReady({
        tournamentId: payload.tournamentId,
        tournamentMatchId: payload.tournamentMatchId,
        roomCode: payload.roomCode.trim(),
        autoRouteInMs,
        redirectAt: Date.now() + autoRouteInMs,
      });
    };

    if (socket.connected) {
      registerAndSubscribe();
    }

    socket.on("connect", registerAndSubscribe);
    socket.on("tournament:matchReady", onMatchReady);

    return () => {
      socket.off("connect", registerAndSubscribe);
      socket.off("tournament:matchReady", onMatchReady);
      unsubscribeTournament();
      clearAutoRouteTimeout();
    };
  }, [
    tournamentId,
    playerId,
    clearAutoRouteTimeout,
  ]);

  return {
    pendingMatchReady,
    matchReadyCountdown,
    enterPendingMatchNow,
  };
}
