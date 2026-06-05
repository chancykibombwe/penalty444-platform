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
    <div className="space-y-4 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          Private Room
        </p>
        <h2 className="mt-1 text-lg font-black text-white">Create Room</h2>
      </div>

      <p className="text-sm text-zinc-400">
        Start a match and share the room code with your opponent.
      </p>

      {challengeUsername ? (
        <div className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-950/20 px-3 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden />
          <p className="text-xs font-semibold text-cyan-100">
            Challenging {challengeUsername}
          </p>
        </div>
      ) : null}

      <button
        onClick={createRoom}
        disabled={loading}
        className="w-full rounded-xl bg-white px-4 py-3 text-sm font-black text-zinc-950 transition-opacity disabled:opacity-50"
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
