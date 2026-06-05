"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RequireAuth from "../../components/auth/RequireAuth";
import PublicMatchOffersPanel from "../../components/lobby/PublicMatchOffersPanel";
import RankedMatchmakingPanel from "../../components/lobby/RankedMatchmakingPanel";
import CreateRoomPanel from "../../components/lobby/CreateRoomPanel";
import JoinRoomPanel from "../../components/lobby/JoinRoomPanel";
import { LobbyConnectionProvider } from "../../lib/socket/LobbyConnectionProvider";

function LobbyPageContent() {
  const searchParams = useSearchParams();
  const challengeUserId = searchParams.get("challengeUserId")?.trim() ?? "";
  const challengeUsername = searchParams.get("challengeUsername")?.trim() ?? "";
  const hasChallengeContext =
    challengeUserId.length > 0 && challengeUsername.length > 0;

  return (
    <RequireAuth>
      <LobbyConnectionProvider>
        {/*
          Full-screen arena shell.
          globals.css sets `background: var(--background)` on both html and
          body (#ffffff in light mode), which overrides the layout's
          bg-zinc-950. Using left-1/2 w-screen -translate-x-1/2 instead of
          negative margins: this sets width to 100vw (viewport-absolute) and
          centers the shell, so the dark bg covers the full viewport regardless
          of any parent container width or overflow-x: hidden interaction.
        */}
        <div className="relative left-1/2 -mt-6 min-h-screen w-screen -translate-x-1/2 overflow-x-hidden bg-zinc-950 pb-28 md:pb-6">

          {/* Atmospheric background layers */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/2 top-0 h-[500px] w-full max-w-3xl -translate-x-1/2 rounded-full bg-violet-700/10 blur-[160px]" />
            <div className="absolute -right-24 top-40 h-72 w-72 rounded-full bg-fuchsia-700/8 blur-[100px]" />
            <div className="absolute -left-24 bottom-1/3 h-56 w-56 rounded-full bg-cyan-900/5 blur-[80px]" />
          </div>

          {/* Page content */}
          <div className="relative mx-auto max-w-4xl space-y-8 px-6 pt-6">

            {/* Page header */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                444 ARENA · Penalty444
              </p>
              <h1 className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
                Match Hub
              </h1>
              <p className="mt-2 text-sm text-zinc-400">
                Find a ranked opponent, create a private room, or join an open
                challenge.
              </p>
            </div>

            {/* Challenge context banner */}
            {hasChallengeContext ? (
              <div className="inline-flex items-start gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 px-4 py-3 shadow-[0_0_20px_rgba(34,211,238,0.07)]">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-cyan-100">
                    Challenging {challengeUsername}
                  </p>
                  <p className="mt-0.5 text-xs text-cyan-200/65">
                    Create a private room and share the code with this player.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Ranked matchmaking — primary action */}
            <RankedMatchmakingPanel />

            {/* Public match offers */}
            <PublicMatchOffersPanel />

            {/* Private rooms */}
            <div>
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                Private Rooms
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <CreateRoomPanel
                  challengeUserId={hasChallengeContext ? challengeUserId : undefined}
                  challengeUsername={
                    hasChallengeContext ? challengeUsername : undefined
                  }
                />
                <JoinRoomPanel />
              </div>
            </div>

          </div>
        </div>
      </LobbyConnectionProvider>
    </RequireAuth>
  );
}

function LobbyPageShell() {
  return (
    <div className="relative left-1/2 -mt-6 min-h-screen w-screen -translate-x-1/2 overflow-x-hidden bg-zinc-950 pb-28 md:pb-6">
      <div className="relative mx-auto max-w-4xl px-6 pt-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            444 ARENA · Penalty444
          </p>
          <h1 className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Match Hub
          </h1>
          <p className="mt-2 text-sm text-zinc-400">Loading match hub…</p>
        </div>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense fallback={<LobbyPageShell />}>
      <LobbyPageContent />
    </Suspense>
  );
}
