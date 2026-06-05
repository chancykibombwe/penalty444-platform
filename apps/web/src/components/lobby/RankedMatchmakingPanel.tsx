"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { useLobbyConnection } from "../../lib/socket/LobbyConnectionProvider";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { saveActiveMatch } from "../../lib/match/activeMatch";

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
      setStatus("Searching for a ranked opponent…");
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
      setStatus("Opponent found. Entering arena…");
      router.push(`/match/${code}`);
    }

    function onRankedError(payload: { message?: string }) {
      console.warn("ranked:error:", payload);
      setEnqueueing(false);
      setCancelling(false);
      setInQueue(false);
      setStatus(payload?.message || "Could not update the ranked queue. Please try again.");
    }

    function onRankedCancelled() {
      setEnqueueing(false);
      setCancelling(false);
      setInQueue(false);
      setStatus("Left ranked queue.");
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
    setStatus("Joining ranked queue…");

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
    <section className="relative space-y-5 overflow-hidden rounded-3xl border border-violet-500/30 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 shadow-[0_0_40px_rgba(139,92,246,0.12),0_8px_32px_rgba(0,0,0,0.5)] sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-violet-600/15 blur-[60px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-8 left-8 h-32 w-32 rounded-full bg-fuchsia-600/10 blur-[40px]" />

      <div>
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/20 ring-1 ring-violet-500/30">
          <svg className="h-5 w-5 text-violet-300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.818a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.845-.143z" />
          </svg>
        </div>

        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-violet-300/70">
          Ranked Arena
        </p>

        <h2 className="mt-0.5 text-3xl font-black tracking-tight text-white sm:text-4xl">
          Quick Match
        </h2>

        <p className="text-sm font-semibold text-violet-300/70">
          Ranked Matchmaking
        </p>

        <p className="mt-3 text-sm text-zinc-400">
          You will be paired with the next available player in the queue.
        </p>

        <p className="mt-3 text-xs text-zinc-500">
          Realtime:{" "}
          <span className={connected ? "text-emerald-400" : "text-red-400"}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={findRankedMatch}
          disabled={!connected || enqueueing || inQueue}
          className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 px-8 py-4 text-sm font-black text-white shadow-[0_0_24px_rgba(139,92,246,0.4)] transition-all hover:shadow-[0_0_32px_rgba(139,92,246,0.5)] disabled:opacity-50"
        >
          {enqueueing && !inQueue ? "Joining…" : "Find Ranked Match"}
        </button>

        <button
          type="button"
          onClick={cancelQueue}
          disabled={!connected || cancelling || (!inQueue && !enqueueing)}
          className="rounded-xl border border-zinc-700 bg-zinc-950/80 px-5 py-4 text-sm font-semibold text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-zinc-100 disabled:opacity-50"
        >
          {cancelling ? "Leaving…" : "Cancel Queue"}
        </button>
      </div>

      {inQueue ? (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-950/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
            <p className="text-sm font-black text-violet-100">
              Searching for a ranked opponent…
            </p>
          </div>
          <p className="mt-1 text-xs text-violet-200/70">
            Stay on this page. You will enter the arena automatically when a
            match is found.
          </p>
        </div>
      ) : null}

      {status ? (
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-400">
          {status}
        </div>
      ) : null}
    </section>
  );
}
