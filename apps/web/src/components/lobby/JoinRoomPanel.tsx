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
    <div className="space-y-4 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          Room Code
        </p>
        <h2 className="mt-1 text-lg font-black text-white">Join Room</h2>
      </div>

      <p className="text-sm text-zinc-400">
        Enter a private room code shared by another player.
      </p>

      <input
        value={roomCode}
        onChange={(event) => setRoomCode(event.target.value)}
        placeholder="Room code"
        className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950 px-4 py-3 font-mono text-sm uppercase tracking-widest text-white outline-none placeholder:text-zinc-600 placeholder:normal-case placeholder:tracking-normal focus:border-zinc-500"
      />

      <button
        onClick={joinRoom}
        className="w-full rounded-xl border border-zinc-700/80 px-4 py-3 text-sm font-black text-white transition-colors hover:border-zinc-500"
      >
        Join Room
      </button>
    </div>
  );
}