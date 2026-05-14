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
  const router = useRouter();

  async function createRoom() {
    if (loading) return;

    const socket = getSocket();

    if (!socket.connected) {
      alert("Connection lost. Try again.");
      return;
    }

    setLoading(true);

    const identity = await getCurrentPlayerIdentity();

    if (!identity) {
      setLoading(false);
      router.replace("/auth/login");
      return;
    }

    socket.emit("room:create", {
      playerId: identity.playerId,
      username: identity.username,
    });

    socket.once("room:created", (payload: { roomCode: string }) => {
      router.push(`/match/${payload.roomCode}`);
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
    </div>
  );
}
