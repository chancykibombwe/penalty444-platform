"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { useLobbyConnection } from "../../lib/socket/LobbyConnectionProvider";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { saveActiveMatch } from "../../lib/match/activeMatch";
import { GradientButton } from "../ui/GradientButton";
import { OutlineButton } from "../ui/OutlineButton";

export default function RankedMatchmakingPanel() {
  const router = useRouter();

  // Hotfix lobby-socket-bootstrap-stability: shared connection state.
  // Previously this panel kept its own `connected` flag and waited for
  // a connect event that another panel had to fire. Reading from the
  // lobby provider removes the race.
  const { connected } = useLobbyConnection();
  const [inQueue, setInQueue] = useState(false);
  const [enqueueing, setEnqueueing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [status, setStatus] = useState("");

  // Track whether we've ever observed a healthy connection — otherwise
  // the initial `connected: false` state on first mount would briefly
  // flash a "Disconnected" status before the socket has finished its
  // first handshake.
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    if (connected) {
      wasConnectedRef.current = true;
      setStatus((prev) =>
        prev === "Disconnected from server. Reconnect to queue again." ||
        prev === "Could not connect to realtime server."
          ? ""
          : prev
      );
      return;
    }

    if (!wasConnectedRef.current) {
      return;
    }

    setInQueue(false);
    setEnqueueing(false);
    setCancelling(false);
    setStatus("Disconnected from server. Reconnect to queue again.");
  }, [connected]);

  useEffect(() => {
    const socket = getSocket();

    function onConnectError() {
      setInQueue(false);
      setEnqueueing(false);
      setCancelling(false);
      setStatus("Could not connect to realtime server.");
    }

    function onRankedQueued() {
      setEnqueueing(false);
      setCancelling(false);
      setInQueue(true);
      setStatus("Looking for an opponent…");
    }

    function onRankedMatched(payload: { roomCode?: string }) {
      setEnqueueing(false);
      setCancelling(false);
      setInQueue(false);

      const code = payload?.roomCode?.trim().toUpperCase();
      if (!code) {
        setStatus("Match found, but room code was missing.");
        return;
      }

      void getCurrentPlayerIdentity().then((identity) => {
        if (identity?.playerId) {
          saveActiveMatch(code, identity.playerId);
        }
      });
      setStatus("Opponent found. Preparing match…");
      router.push(`/match/${code}`);
    }

    function onRankedError(payload: { message?: string }) {
      console.warn("ranked:error:", payload);
      setEnqueueing(false);
      setCancelling(false);
      setInQueue(false);
      setStatus(payload?.message || "Could not update the match queue. Please try again.");
    }

    function onRankedCancelled() {
      setEnqueueing(false);
      setCancelling(false);
      setInQueue(false);
      setStatus("Left the queue. You can rejoin any time.");
    }

    socket.on("connect_error", onConnectError);
    socket.on("ranked:queued", onRankedQueued);
    socket.on("ranked:matched", onRankedMatched);
    socket.on("ranked:error", onRankedError);
    socket.on("ranked:cancelled", onRankedCancelled);

    return () => {
      socket.off("connect_error", onConnectError);
      socket.off("ranked:queued", onRankedQueued);
      socket.off("ranked:matched", onRankedMatched);
      socket.off("ranked:error", onRankedError);
      socket.off("ranked:cancelled", onRankedCancelled);
    };
  }, [router]);

  async function findRankedMatch() {
    if (enqueueing || inQueue) return;

    const socket = getSocket();

    if (!socket.connected) {
      // The provider owns the connect lifecycle; just surface a status
      // and bail. socket.io's reconnection loop will recover.
      setStatus("Connecting to server. Try again in a second.");
      return;
    }

    setEnqueueing(true);
    setStatus("Joining match queue…");

    try {
      const identity = await getCurrentPlayerIdentity();

      if (!identity) {
        setEnqueueing(false);
        router.replace("/auth/login");
        return;
      }

      socket.emit("ranked:enqueue", {
        playerId: identity.playerId,
        username: identity.username,
      });
    } catch {
      setEnqueueing(false);
      setStatus("Failed to load player identity. Please log in again.");
    }
  }

  async function cancelQueue() {
    if (!inQueue && !enqueueing) return;

    const socket = getSocket();

    if (!socket.connected) {
      setInQueue(false);
      setEnqueueing(false);
      setStatus("Disconnected. Queue cleared locally.");
      return;
    }

    setCancelling(true);
    setStatus("Leaving queue…");

    try {
      const identity = await getCurrentPlayerIdentity();

      if (!identity) {
        setCancelling(false);
        router.replace("/auth/login");
        return;
      }

      socket.emit("ranked:cancel", {
        playerId: identity.playerId,
      });
    } catch {
      setCancelling(false);
      setStatus("Could not cancel queue.");
    }
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-[#3B9EFF]/30 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-2.5 shadow-[0_0_60px_rgba(59,158,255,0.15),0_8px_32px_rgba(0,0,0,0.5)] sm:p-4 md:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#3B9EFF]/15 blur-[80px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-12 left-4 h-48 w-48 rounded-full bg-[#1E6FE0]/10 blur-[60px]" />

      {/* Two-zone layout: left content + right decorative arena art */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">

        {/* Left zone — all interactive content */}
        <div className="min-w-0 flex-1 space-y-1 sm:space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-[#3B9EFF]/15 ring-1 ring-[#3B9EFF]/30">
                  <svg className="h-3.5 w-3.5 text-[#9AD2FF]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.818a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.845-.143z" />
                  </svg>
                </div>

                <h2 className="text-lg font-black tracking-tight text-white sm:text-xl md:text-2xl">
                  Quick Match
                </h2>
              </div>

              <p className="hidden text-[10px] font-black uppercase tracking-[0.3em] text-[#3B9EFF]/70 sm:mt-1.5 sm:block">
                Free Play · Beta
              </p>

              <p className="hidden text-xs text-zinc-400 sm:mt-2 sm:block sm:text-sm">
                Free · 3 rounds. You&apos;ll be paired with the next available
                player.
              </p>
              <p className="mt-1 hidden text-xs text-zinc-500 sm:block">
                Results count toward your global stats and rank.
              </p>

              <p className="text-[11px] text-zinc-500 sm:mt-2 sm:text-xs">
                Realtime:{" "}
                <span className={connected ? "text-emerald-400" : "text-red-400"}>
                  {connected ? "Connected" : "Disconnected"}
                </span>
              </p>
            </div>

            <GradientButton
              variant="primary"
              onClick={findRankedMatch}
              disabled={!connected || enqueueing || inQueue}
              className="shrink-0 !min-h-[40px] !py-2"
            >
              <span className="sm:hidden">{enqueueing && !inQueue ? "Joining…" : "Find Match"}</span>
              <span className="hidden sm:inline">{enqueueing && !inQueue ? "Joining…" : "Find Free Match"}</span>
            </GradientButton>
          </div>

          {inQueue || enqueueing || cancelling ? (
            <OutlineButton
              tone="muted"
              onClick={cancelQueue}
              disabled={!connected || cancelling || (!inQueue && !enqueueing)}
              className="w-full sm:w-auto"
            >
              {cancelling ? "Leaving…" : "Cancel Queue"}
            </OutlineButton>
          ) : null}

          {inQueue ? (
            <div className="rounded-2xl border border-[#3B9EFF]/30 bg-[#3B9EFF]/10 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#3B9EFF]" />
                <p className="text-sm font-black text-[#9AD2FF]">
                  Searching for opponent…
                </p>
              </div>
              <p className="mt-1 text-xs text-[#9AD2FF]/70">
                Stay on this page. When an opponent is found, the match starts automatically.
              </p>
            </div>
          ) : null}

          {status ? (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-400">
              {status}
            </div>
          ) : null}
        </div>

        {/* Right zone — purely decorative arena art, desktop only */}
        <div aria-hidden className="pointer-events-none hidden shrink-0 sm:flex sm:w-32 sm:items-center sm:justify-center md:w-40">
          <div className="relative flex h-32 w-32 items-center justify-center md:h-40 md:w-40">
            <div className="absolute inset-0 rounded-full border border-[#3B9EFF]/15" />
            <div className="absolute inset-5 rounded-full border border-[#3B9EFF]/10" />
            <div className="absolute inset-10 rounded-full border border-[#3B9EFF]/8" />
            <div className="absolute inset-0 rounded-full bg-[#1E6FE0]/8 blur-2xl" />
            <svg
              className="relative h-14 w-14 text-[#3B9EFF]/25 md:h-16 md:w-16"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.818a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.845-.143z" />
            </svg>
          </div>
        </div>

      </div>
    </section>
  );
}
