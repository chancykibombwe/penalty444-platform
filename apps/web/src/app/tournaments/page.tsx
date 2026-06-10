"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import RequireAuth from "../../components/auth/RequireAuth";
import CreateTournamentPanel from "../../components/tournament/CreateTournamentPanel";
import TournamentHubHero, {
  type TournamentHubStats,
} from "../../components/tournament/TournamentHubHero";
import TournamentListPanel from "../../components/tournament/TournamentListPanel";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import {
  clearActiveTournamentIfPlayerMismatch,
  getActiveTournament,
  subscribeActiveTournament,
  type ActiveTournament,
} from "../../lib/tournament/activeTournament";
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
  const [activeTournament, setActiveTournament] =
    useState<ActiveTournament | null>(null);

  useTournamentRealtime({ playerId: currentUserId });

  useEffect(() => {
    let cancelled = false;

    void getCurrentPlayerIdentity().then((identity) => {
      if (!cancelled) {
        const playerId = identity?.playerId ?? null;
        setCurrentUserId(playerId);
        if (playerId) {
          clearActiveTournamentIfPlayerMismatch(playerId);
          setActiveTournament(getActiveTournament(playerId));
        } else {
          setActiveTournament(getActiveTournament() ?? null);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to live changes (same-tab + cross-tab) so the resume hero is
  // always in sync with the snapshot.
  useEffect(() => {
    const unsubscribe = subscribeActiveTournament(() => {
      setActiveTournament(getActiveTournament(currentUserId ?? undefined));
    });
    return unsubscribe;
  }, [currentUserId]);

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

  // Even outside dev-schedule-sync, bump the list version on focus + every
  // few seconds while the user has a persistent active tournament. The list
  // panel reads `listVersion` to re-fetch, so this keeps the page sync'd.
  useEffect(() => {
    const handleFocus = () => {
      console.info("[TournamentSync] window focus → bump listVersion");
      setListVersion((version) => version + 1);
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!activeTournament) return;
    if (activeTournament.lastKnownState !== "in_progress") return;

    // The user is mid-tournament — bump the list periodically so the Active
    // For You pin & Resume CTA always reflect fresh server state.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      console.info(
        "[TournamentSync] active in_progress → silent listVersion bump"
      );
      setListVersion((version) => version + 1);
    }, 8_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTournament]);

  const activeStateCopy = activeTournament
    ? activeStateLine(activeTournament.lastKnownState)
    : null;

  const [stats, setStats] = useState<TournamentHubStats>({
    live: 0,
    upcoming: 0,
    mine: 0,
    completed: 0,
  });
  const [listLoading, setListLoading] = useState(true);

  const handleStatsChanged = useCallback((next: TournamentHubStats) => {
    setStats(next);
  }, []);
  const handleLoadingChanged = useCallback((loading: boolean) => {
    setListLoading(loading);
  }, []);

  return (
    <RequireAuth>
      <section className="space-y-7 sm:space-y-8">
        <TournamentHubHero stats={stats} isLoading={listLoading} />

        {activeTournament ? (
          <section
            className={`relative overflow-hidden rounded-2xl border-2 px-4 py-4 shadow-2xl sm:px-5 sm:py-5 ${
              activeTournament.lastKnownState === "in_progress"
                ? "border-cyan-400/55 bg-gradient-to-br from-cyan-950/35 via-zinc-950 to-black shadow-[0_0_36px_rgba(34,211,238,0.2)]"
                : "border-amber-400/55 bg-gradient-to-br from-amber-950/30 via-zinc-950 to-black shadow-[0_0_28px_rgba(251,191,36,0.18)]"
            }`}
            aria-label="Resume active tournament"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
                      activeTournament.lastKnownState === "in_progress"
                        ? "border-cyan-400/55 bg-cyan-500/15 text-cyan-100"
                        : "border-amber-400/55 bg-amber-500/15 text-amber-100"
                    }`}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-90"
                      aria-hidden
                    />
                    {activeTournament.lastKnownState === "in_progress"
                      ? "Your tournament is live"
                      : "You are still in this tournament"}
                  </span>
                  {activeTournament.tierLabel ? (
                    <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-300">
                      {activeTournament.tierLabel}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 break-words text-lg font-black tracking-tight text-white sm:text-xl">
                  {activeTournament.tournamentName}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">
                  {activeStateCopy}
                </p>
              </div>
              <Link
                href={`/tournaments/${activeTournament.tournamentId}`}
                className={`inline-flex w-full shrink-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-black shadow-lg sm:w-auto ${
                  activeTournament.lastKnownState === "in_progress"
                    ? "bg-gradient-to-r from-cyan-400 to-amber-500 text-zinc-950 hover:from-cyan-300 hover:to-amber-400"
                    : "bg-gradient-to-r from-amber-400 to-orange-500 text-zinc-950 hover:from-amber-300 hover:to-orange-400"
                }`}
              >
                Resume Tournament →
              </Link>
            </div>
          </section>
        ) : null}

        <TournamentListPanel
          listVersion={listVersion}
          activeTournamentId={activeTournament?.tournamentId ?? null}
          defaultFilter="live"
          onStatsChanged={handleStatsChanged}
          onLoadingChanged={handleLoadingChanged}
        />

        <CreateTournamentPanel
          onCreated={() => setListVersion((version) => version + 1)}
        />
      </section>
    </RequireAuth>
  );
}

function activeStateLine(state: ActiveTournament["lastKnownState"]): string {
  switch (state) {
    case "in_progress":
      return "Resume to play your next bracket match.";
    case "check_in":
      return "Head back to continue your tournament match.";
    case "registration":
      return "Registration is still open — head back when you're ready.";
    default:
      return "Pick up where you left off.";
  }
}
