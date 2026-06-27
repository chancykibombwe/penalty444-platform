"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RequireAuth from "../../components/auth/RequireAuth";
import PublicMatchOffersPanel from "../../components/lobby/PublicMatchOffersPanel";
import RankedMatchmakingPanel from "../../components/lobby/RankedMatchmakingPanel";
import CreateRoomPanel from "../../components/lobby/CreateRoomPanel";
import JoinRoomPanel from "../../components/lobby/JoinRoomPanel";
import LobbyStatusStrip from "../../components/lobby/LobbyStatusStrip";
import LobbyChatPanel from "../../components/lobby/LobbyChatPanel";
import ChallengePlayerPanel from "../../components/lobby/ChallengePlayerPanel";
import { LobbyConnectionProvider } from "../../lib/socket/LobbyConnectionProvider";
import { resolveChallengeTarget } from "../../lib/challenge/challengeLinks";
import EmptyState from "../../components/ui/EmptyState";

function LobbyPageContent() {
  const searchParams = useSearchParams();
  // Canonical `?challenge=<username>` plus legacy
  // `?challengeUserId=&challengeUsername=` are both supported.
  const challengeUsername = resolveChallengeTarget({
    challenge: searchParams.get("challenge"),
    challengeUsername: searchParams.get("challengeUsername"),
  });
  const hasChallengeContext = challengeUsername.length > 0;
  // Optional Join Room prefill from a shared invite link.
  const joinRoomCode = searchParams.get("join")?.trim().toUpperCase() ?? "";

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
          <div className="relative mx-auto max-w-6xl space-y-2 px-4 pt-2.5 sm:space-y-3 sm:px-6 sm:pt-4 lg:pt-5">

            {/* Page header */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                444 ARENA · Penalty444
              </p>
              <h1 className="mt-0.5 text-lg font-black tracking-tight text-white sm:text-2xl md:text-4xl">
                Lobby
              </h1>
              <p className="mt-0.5 hidden text-xs text-zinc-400 sm:block sm:text-sm">
                Find an opponent, create a private room, or join an open
                challenge.
              </p>
            </div>

            <LobbyStatusStrip />

            {/* Challenge Player panel — frames the Private Room flow below */}
            {hasChallengeContext ? (
              <ChallengePlayerPanel targetUsername={challengeUsername} />
            ) : null}

            {/* Main column + sidebar on desktop; stacked on mobile */}
            <div className="grid gap-2 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-5">
              <div className="space-y-2 sm:space-y-3 lg:space-y-5">
                {/* Ranked matchmaking — primary action */}
                <RankedMatchmakingPanel />

                {/* Public match offers */}
                <PublicMatchOffersPanel />

                {/* Private rooms */}
                <div>
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 sm:mb-2">
                    Private Rooms
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    <CreateRoomPanel
                      challengeUsername={
                        hasChallengeContext ? challengeUsername : undefined
                      }
                    />
                    <JoinRoomPanel initialRoomCode={joinRoomCode || undefined} />
                  </div>
                </div>

              </div>

              {/* Sidebar (stacks below main column on mobile) */}
              <aside className="space-y-2 sm:space-y-3 lg:sticky lg:top-20 lg:space-y-5">
                {/* Play Again — recent opponents, collapsible */}
                <details className="group overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 [&::-webkit-details-marker]:hidden">
                    <span>Play Again</span>
                    <span className="text-zinc-500 transition-transform group-open:rotate-180" aria-hidden>
                      ▾
                    </span>
                  </summary>
                  <div className="border-t border-zinc-800/60 p-2 sm:p-3">
                    <EmptyState
                      icon="🤝"
                      title="Recent opponents appear here"
                      subtitle="Play a match to start building your rematch list"
                      compact
                    />
                  </div>
                </details>

                {/* Arena Chat — global lobby chat (Free Play beta) */}
                <LobbyChatPanel />
              </aside>
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
      <div className="relative mx-auto max-w-6xl px-4 pt-3 sm:px-6 sm:pt-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            444 ARENA · Penalty444
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl md:text-4xl">
            Lobby
          </h1>
          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">Loading lobby…</p>
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
