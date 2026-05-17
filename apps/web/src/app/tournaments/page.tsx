"use client";

import { useState } from "react";
import RequireAuth from "../../components/auth/RequireAuth";
import CreateTournamentPanel from "../../components/tournament/CreateTournamentPanel";
import TournamentListPanel from "../../components/tournament/TournamentListPanel";

export default function TournamentsPage() {
  const [listVersion, setListVersion] = useState(0);

  return (
    <RequireAuth>
      <section className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Tournaments</h1>
          <p className="mt-2 text-zinc-400">
            Create or join single-elimination events. Browse active tournaments
            or review completed brackets.
          </p>
        </div>

        <CreateTournamentPanel
          onCreated={() => setListVersion((version) => version + 1)}
        />

        <TournamentListPanel listVersion={listVersion} />
      </section>
    </RequireAuth>
  );
}
