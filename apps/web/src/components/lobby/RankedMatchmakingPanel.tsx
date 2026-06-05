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
    <section className="space-y-5 overflow-hidden rounded-3xl border border-violet-500/30 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 shadow-[0_0_40px_rgba(139,92,246,0.12),0_8px_32px_rgba(0,0,0,0.5)] sm:p-7">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-violet-300/70">
          Ranked Arena
        </p>

        <h2 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
          Ranked Matchmaking
        </h2>

        <p className="mt-2 text-sm text-zinc-400">
          Free match. You will be paired with the next available player in the
          queue.
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
          className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-violet-900/40 transition-opacity disabled:opacity-50"
        >
          {enqueueing && !inQueue ? "Joining…" : "Find Ranked Match"}
        </button>

        <button
          type="button"
          onClick={cancelQueue}
          disabled={!connected || cancelling || (!inQueue && !enqueueing)}
          className="rounded-xl border border-zinc-700 bg-zinc-950/80 px-5 py-3.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-zinc-100 disabled:opacity-50"
        >
          {cancelling ? "Leaving…" : "Cancel Queue"}
        </button>
      </div>

      {inQueue ? (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-950/20 px-4 py-3">
          <p className="text-sm font-black text-violet-100">
            Searching for a ranked opponent…
          </p>
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
