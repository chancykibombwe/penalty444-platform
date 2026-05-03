"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinRoomPanel() {
  const [roomCode, setRoomCode] = useState("");
  const router = useRouter();

  function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    router.push(`/match/${code}`);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-xl font-semibold text-white">Join Room</h2>

      <p className="text-zinc-400">
        Enter a private room code shared by another player.
      </p>

      <input
        value={roomCode}
        onChange={(event) => setRoomCode(event.target.value)}
        placeholder="Room Code"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none"
      />

      <button
        onClick={joinRoom}
        className="w-full rounded-xl border border-zinc-700 px-4 py-3 font-semibold text-white"
      >
        Join Room
      </button>
    </div>
  );
}