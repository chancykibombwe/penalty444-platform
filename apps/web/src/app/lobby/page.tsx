"use client";

import RequireAuth from "../../components/auth/RequireAuth";
import PublicMatchOffersPanel from "../../components/lobby/PublicMatchOffersPanel";
import CreateRoomPanel from "../../components/lobby/CreateRoomPanel";
import JoinRoomPanel from "../../components/lobby/JoinRoomPanel";

export default function LobbyPage() {
  return (
    <RequireAuth>
      <section className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Match Hub</h1>
          <p className="mt-2 text-zinc-400">
            Create public challenges, private rooms, or join with a code.
          </p>
        </div>

        <PublicMatchOffersPanel />

        <div className="grid gap-6 md:grid-cols-2">
          <CreateRoomPanel />
          <JoinRoomPanel />
        </div>
      </section>
    </RequireAuth>
  );
}