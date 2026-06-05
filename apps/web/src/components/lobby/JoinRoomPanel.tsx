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
    <div className="space-y-4 overflow-hidden rounded-2xl border border-emerald-500/25 bg-zinc-950/80 p-6 shadow-[0_0_24px_rgba(16,185,129,0.07),0_8px_24px_rgba(0,0,0,0.4)]">
      <div>
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 ring-1 ring-emerald-500/25">
          <svg className="h-4 w-4 text-emerald-300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.72 7.72a.75.75 0 011.06 0l3.75 3.75a.75.75 0 010 1.06l-3.75 3.75a.75.75 0 11-1.06-1.06l2.47-2.47H3a.75.75 0 010-1.5h16.19l-2.47-2.47a.75.75 0 010-1.06z" />
          </svg>
        </div>
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
        className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950 px-4 py-3 font-mono text-sm uppercase tracking-widest text-white outline-none placeholder:text-zinc-600 placeholder:normal-case placeholder:tracking-normal focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/10"
      />

      <button
        onClick={joinRoom}
        className="w-full rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-sm font-black text-emerald-100 transition-colors hover:border-emerald-400/50 hover:bg-emerald-950/40"
      >
        Join Room
      </button>
    </div>
  );
}