"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import RequireAuth from "../../components/auth/RequireAuth";
import PublicMatchOffersPanel from "../../components/lobby/PublicMatchOffersPanel";
import RankedMatchmakingPanel from "../../components/lobby/RankedMatchmakingPanel";
import CreateRoomPanel from "../../components/lobby/CreateRoomPanel";
import JoinRoomPanel from "../../components/lobby/JoinRoomPanel";
import {
  LobbyConnectionProvider,
  useLobbyConnection,
} from "../../lib/socket/LobbyConnectionProvider";

function OpponentReadyBanner() {
  const { opponentReadyRoomCode, clearOpponentReady } = useLobbyConnection();
  if (!opponentReadyRoomCode) return null;

  return (
    <div className="rounded-xl border border-emerald-400/40 bg-emerald-950/30 px-4 py-3 shadow-[0_0_24px_rgba(52,211,153,0.12)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-emerald-100">
            Match Ready — Opponent is waiting
          </p>
          <p className="mt-0.5 text-xs text-emerald-100/70">
            Return now before the window closes.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/match/${opponentReadyRoomCode}`}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-400"
          >
            Join Now
          </Link>
          <button
            onClick={clearOpponentReady}
            className="rounded-lg border border-zinc-600 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function LobbyPageContent() {
  const searchParams = useSearchParams();
  const challengeUserId = searchParams.get("challengeUserId")?.trim() ?? "";
  const challengeUsername = searchParams.get("challengeUsername")?.trim() ?? "";
  const hasChallengeContext =
    challengeUserId.length > 0 && challengeUsername.length > 0;

  return (
    <RequireAuth>
      <LobbyConnectionProvider>
      <section className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Match Hub</h1>
          <p className="mt-2 text-zinc-400">
            Find a ranked opponent, create public challenges, private rooms, or
            join with a code.
          </p>
          {hasChallengeContext ? (
            <div className="mt-4 rounded-xl border border-cyan-400/30 bg-cyan-950/20 px-4 py-3 shadow-[0_0_20px_rgba(34,211,238,0.08)]">
              <p className="text-sm font-semibold text-cyan-100">
                Challenging {challengeUsername}
              </p>
              <p className="mt-1 text-sm text-cyan-100/70">
                Create a room and share the match link or room code with this
                player.
              </p>
            </div>
          ) : null}
        </div>

        <OpponentReadyBanner />

        <RankedMatchmakingPanel />

        <PublicMatchOffersPanel />

        <div className="grid gap-6 md:grid-cols-2">
          <CreateRoomPanel
            challengeUserId={hasChallengeContext ? challengeUserId : undefined}
            challengeUsername={
              hasChallengeContext ? challengeUsername : undefined
            }
          />
          <JoinRoomPanel />
        </div>
      </section>
      </LobbyConnectionProvider>
    </RequireAuth>
  );
}

export default function LobbyPage() {
  return (
    <Suspense
      fallback={
        <section className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Match Hub</h1>
            <p className="mt-2 text-zinc-400">Loading match hub…</p>
          </div>
        </section>
      }
    >
      <LobbyPageContent />
    </Suspense>
  );
}
