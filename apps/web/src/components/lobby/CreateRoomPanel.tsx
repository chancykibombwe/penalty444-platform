"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../../lib/socket/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";

type CreateRoomPanelProps = {
  challengeUserId?: string;
  challengeUsername?: string;
};

export default function CreateRoomPanel({
  challengeUserId,
  challengeUsername,
}: CreateRoomPanelProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function createRoom() {
    if (loading) return;

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
      setStatus("Connecting to server. Please try again in a moment.");
      return;
    }

    setStatus(null);
    setLoading(true);

    const identity = await getCurrentPlayerIdentity();

    if (!identity) {
      setLoading(false);
      router.replace("/auth/login");
      return;
    }

    const onCreated = (payload: { roomCode: string }) => {
      cleanup();
      router.push(`/match/${payload.roomCode}`);
    };

    // Server surfaces room-create failures (auth/rate-limit) via
    // `error:message`. Log the detail for debugging but only show the
    // user a friendly fallback — never the raw server string.
    const onError = (payload?: { message?: string }) => {
      cleanup();
      console.warn("room:create failed:", payload);
      setLoading(false);
      setStatus("Could not create room. Please try again.");
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      setLoading(false);
      setStatus("Server is not responding. Please try again.");
    }, 8000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      socket.off("room:created", onCreated);
      socket.off("error:message", onError);
    }

    socket.on("room:created", onCreated);
    socket.on("error:message", onError);

    socket.emit("room:create", {
      playerId: identity.playerId,
      username: identity.username,
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-xl font-semibold text-white">Create Private Room</h2>

      <p className="text-zinc-400">
        Start a match and share the room code with your opponent.
      </p>

      {challengeUsername ? (
        <p className="text-sm text-cyan-100/80">
          Challenge target: {challengeUsername}
        </p>
      ) : null}

      <button
        onClick={createRoom}
        disabled={loading}
        className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create Room"}
      </button>

      {status ? (
        <p className="text-sm text-amber-200/90" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </div>
  );
}
