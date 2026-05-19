"use client";

import { useEffect, useState } from "react";
import RequireAuth from "../../components/auth/RequireAuth";
import CreateTournamentPanel from "../../components/tournament/CreateTournamentPanel";
import TournamentListPanel from "../../components/tournament/TournamentListPanel";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { useTournamentRealtime } from "../../lib/tournament/useTournamentRealtime";

const DEV_SCHEDULE_SYNC_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEV_SCHEDULE_SYNC === "true";

const DEV_SCHEDULE_SYNC_INTERVAL_MS = 30_000;

async function runDevTournamentScheduleSync(): Promise<void> {
  if (!DEV_SCHEDULE_SYNC_ENABLED) {
    return;
  }

  try {
    await fetch("/api/internal/tournaments/tick", {
      method: "POST",
      headers: { "x-dev-schedule-sync": "1" },
      cache: "no-store",
    });
  } catch {
    // Best-effort local scheduler; production uses cron + CRON_SECRET.
  }
}

export default function TournamentsPage() {
  const [listVersion, setListVersion] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useTournamentRealtime({ playerId: currentUserId });

  useEffect(() => {
    let cancelled = false;

    void getCurrentPlayerIdentity().then((identity) => {
      if (!cancelled) {
        setCurrentUserId(identity?.playerId ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!DEV_SCHEDULE_SYNC_ENABLED) {
      return;
    }

    const syncAndRefresh = async () => {
      await runDevTournamentScheduleSync();
      setListVersion((version) => version + 1);
    };

    void syncAndRefresh();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void syncAndRefresh();
    }, DEV_SCHEDULE_SYNC_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncAndRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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
