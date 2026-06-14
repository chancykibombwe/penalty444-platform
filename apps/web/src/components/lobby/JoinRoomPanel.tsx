"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OutlineButton } from "../ui/OutlineButton";

export default function JoinRoomPanel() {
  const [roomCode, setRoomCode] = useState("");
  const router = useRouter();

  function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    router.push(`/match/${code}`);
  }

  return (
    <div className="space-y-2 overflow-hidden rounded-2xl border border-[#22C55E]/30 bg-[#0D1420] p-2 shadow-[0_0_24px_rgba(34,197,94,0.14)] sm:space-y-3 sm:p-3.5">
      <div>
        <div className="flex items-center gap-2 sm:block">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#22C55E]/15 ring-1 ring-[#22C55E]/30 sm:mb-1.5">
            <svg className="h-3.5 w-3.5 text-[#86EFAC]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16.72 7.72a.75.75 0 011.06 0l3.75 3.75a.75.75 0 010 1.06l-3.75 3.75a.75.75 0 11-1.06-1.06l2.47-2.47H3a.75.75 0 010-1.5h16.19l-2.47-2.47a.75.75 0 010-1.06z" />
            </svg>
          </div>
          <h2 className="text-base font-black text-white sm:mt-0.5">Join Room</h2>
        </div>
        <p className="hidden text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 sm:block">
          Room Code
        </p>
      </div>

      <p className="hidden text-sm text-zinc-400 sm:block">
        Enter a private room code shared by another player.
      </p>

      <input
        value={roomCode}
        onChange={(event) => setRoomCode(event.target.value)}
        placeholder="Room code"
        className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950 px-3.5 py-2.5 font-mono text-sm uppercase tracking-widest text-white outline-none placeholder:text-zinc-600 placeholder:normal-case placeholder:tracking-normal focus:border-[#22C55E]/60 focus:ring-2 focus:ring-[#22C55E]/10"
      />

      <OutlineButton tone="positive" onClick={joinRoom} className="w-full">
        Join Room
      </OutlineButton>
    </div>
  );
}