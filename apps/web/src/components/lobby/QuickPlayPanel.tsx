"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";

export default function QuickPlayPanel() {
  const router = useRouter();

  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("Find an opponent automatically.");

  useEffect(() => {
    const socket = getSocket();

    function onStatus(payload: { message: string }) {
      setStatus(payload.message);
    }

    function onFound(payload: { roomCode: string }) {
      setStatus("Match found. Entering room...");
      setSearching(false);
      router.push(`/match/${payload.roomCode}`);
    }

    socket.on("matchmaking:status", onStatus);
    socket.on("matchmaking:found", onFound);

    return () => {
      socket.off("matchmaking:status", onStatus);
      socket.off("matchmaking:found", onFound);
    };
  }, [router]);

  async function startQuickPlay() {
    if (searching) return;

    const socket = getSocket();

    if (!socket.connected) {
      setStatus("Connection lost. Please refresh and try again.");
      return;
    }

    const identity = await getCurrentPlayerIdentity();

    if (!identity) {
      router.replace("/auth/login");
      return;
    }

    setSearching(true);
    setStatus("Searching for opponent...");

    socket.emit("matchmaking:join", {
      playerId: identity.playerId,
      username: identity.username,
    });
  }

  async function cancelSearch() {
    const socket = getSocket();
    const identity = await getCurrentPlayerIdentity();

    if (!identity) {
      router.replace("/auth/login");
      setSearching(false);
      setStatus("Search cancelled.");
      return;
    }

    socket.emit("matchmaking:cancel", {
      playerId: identity.playerId,
    });

    setSearching(false);
    setStatus("Search cancelled.");
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-lg">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Public Match
        </p>
        <h2 className="mt-2 text-2xl font-bold text-white">Quick Play</h2>
      </div>

      <p className="text-zinc-400">{status}</p>

      {!searching ? (
        <button
          onClick={startQuickPlay}
          className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950"
        >
          Start Quick Play
        </button>
      ) : (
        <button
          onClick={cancelSearch}
          className="w-full rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-white"
        >
          Cancel Search
        </button>
      )}
    </div>
  );
}