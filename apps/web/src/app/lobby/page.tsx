"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RequireAuth from "../../components/auth/RequireAuth";
import PublicMatchOffersPanel from "../../components/lobby/PublicMatchOffersPanel";
import RankedMatchmakingPanel from "../../components/lobby/RankedMatchmakingPanel";
import CreateRoomPanel from "../../components/lobby/CreateRoomPanel";
import JoinRoomPanel from "../../components/lobby/JoinRoomPanel";

function LobbyPageContent() {
  const searchParams = useSearchParams();
  const challengeUserId = searchParams.get("challengeUserId")?.trim() ?? "";
  const challengeUsername = searchParams.get("challengeUsername")?.trim() ?? "";
  const hasChallengeContext =
    challengeUserId.length > 0 && challengeUsername.length > 0;

  return (
    <RequireAuth>
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
