"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import TournamentEntryActions from "./TournamentEntryActions";

export type TournamentRow = {
  id: string;
  game_id: string;
  name: string;
  status: string;
  format: string;
  max_players: number;
  rounds_per_match: number;
  created_by: string;
  starts_at: string | null;
  created_at: string;
  winner_id: string | null;
  updated_at: string;
};

export type TournamentEntryRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  username: string;
  status: string;
  checked_in_at: string | null;
};

export type TournamentListFilter = "active" | "registration" | "completed" | "mine";

const FILTER_OPTIONS: { id: TournamentListFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "registration", label: "Registration" },
  { id: "completed", label: "Completed" },
  { id: "mine", label: "Mine" },
];

const ACTIVE_STATUSES = new Set(["registration", "check_in", "in_progress"]);
const REGISTRATION_STATUSES = new Set(["registration", "check_in"]);
const LIVE_LIST_POLL_INTERVAL_MS = 12_000;
const VISIBILITY_REFRESH_DEBOUNCE_MS = 2_000;

/** Normalize Supabase `status` for exact comparisons (never use display labels). */
export function normalizeTournamentStatus(
  status: string | null | undefined
): string {
  const normalized = (status ?? "").trim().toLowerCase().replace(/\s+/g, "_");

  if (normalized === "complete") {
    return "completed";
  }

  if (normalized === "check-in" || normalized === "checkin") {
    return "check_in";
  }

  if (normalized === "in-progress") {
    return "in_progress";
  }

  return normalized;
}

export function isCancelledTournament(status: string | null | undefined): boolean {
  return normalizeTournamentStatus(status) === "cancelled";
}

export function isCompletedTournament(status: string | null | undefined): boolean {
  return normalizeTournamentStatus(status) === "completed";
}

export function isActiveTournament(status: string | null | undefined): boolean {
  return ACTIVE_STATUSES.has(normalizeTournamentStatus(status));
}

function isRegistrationTabStatus(status: string | null | undefined): boolean {
  return REGISTRATION_STATUSES.has(normalizeTournamentStatus(status));
}

function logTournamentStatusTable(rows: TournamentRow[]) {
  console.table(
    rows.map((tournament) => ({
      name: tournament.name,
      status: tournament.status,
      normalized: normalizeTournamentStatus(tournament.status),
    }))
  );
}

export function formatTournamentStatus(status: string): string {
  switch (normalizeTournamentStatus(status)) {
    case "registration":
      return "Registration";
    case "check_in":
      return "Ready Phase";
    case "in_progress":
      return "Live";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "draft":
      return "Draft";
    default:
      return status.replace(/_/g, " ");
  }
}

export function formatEntryStatus(status: string): string {
  switch (status) {
    case "registered":
      return "Registered";
    case "checked_in":
      return "Ready";
    case "withdrawn":
      return "Withdrawn";
    default:
      return status.replace(/_/g, " ");
  }
}

export function statusBadgeClass(status: string) {
  switch (normalizeTournamentStatus(status)) {
    case "registration":
      return "border-emerald-500/40 bg-emerald-950/30 text-emerald-200";
    case "check_in":
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
    case "in_progress":
      return "border-cyan-500/40 bg-cyan-950/30 text-cyan-200";
    case "completed":
      return "border-zinc-500/40 bg-zinc-800/50 text-zinc-300";
    case "cancelled":
      return "border-red-500/40 bg-red-950/30 text-red-200";
    default:
      return "border-zinc-600/40 bg-zinc-900 text-zinc-400";
  }
}

function formatStartsAt(value: string | null) {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function resolveChampionUsername(
  tournament: Pick<TournamentRow, "winner_id">,
  entries: TournamentEntryRow[]
): string | null {
  if (!tournament.winner_id) {
    return null;
  }

  const winnerEntry = entries.find(
    (entry) => entry.user_id === tournament.winner_id
  );
  return winnerEntry?.username ?? null;
}

function formatCompletedAt(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) {
      const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
      return `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

/**
 * Final client-side tab filter (exact DB status values, normalized).
 * Applied immediately before render so stale rows never leak across tabs.
 */
function filterTournamentsForTab(
  rows: TournamentRow[],
  filter: TournamentListFilter,
  currentUserId: string | null,
  myEntriesByTournament: Map<string, TournamentEntryRow>
): TournamentRow[] {
  return rows.filter((tournament) => {
    if (isCancelledTournament(tournament.status)) {
      return false;
    }

    if (
      normalizeTournamentStatus(tournament.status) === "draft" &&
      filter !== "mine"
    ) {
      return false;
    }

    switch (filter) {
      case "active":
        return (
          isActiveTournament(tournament.status) &&
          !isCompletedTournament(tournament.status)
        );
      case "registration":
        return isRegistrationTabStatus(tournament.status);
      case "completed":
        return isCompletedTournament(tournament.status);
      case "mine":
        if (
          isCancelledTournament(tournament.status) ||
          isCompletedTournament(tournament.status)
        ) {
          return false;
        }
        return isMineTournament(
          tournament,
          currentUserId,
          myEntriesByTournament
        );
      default:
        return false;
    }
  });
}

function isMineTournament(
  tournament: TournamentRow,
  currentUserId: string | null,
  myEntriesByTournament: Map<string, TournamentEntryRow>
): boolean {
  if (!currentUserId) {
    return false;
  }

  return (
    tournament.created_by === currentUserId ||
    myEntriesByTournament.has(tournament.id)
  );
}

function getSectionCopy(filter: TournamentListFilter) {
  switch (filter) {
    case "active":
      return {
        title: "Active Tournaments",
        description:
          "Join, mark Ready, or follow brackets for events in progress.",
      };
    case "registration":
      return {
        title: "Registration Open",
        description:
          "Sign up or get Ready before the host starts the bracket.",
      };
    case "completed":
      return {
        title: "Tournament History",
        description: "Finished events and champions from past brackets.",
      };
    case "mine":
      return {
        title: "My Tournaments",
        description:
          "Events you host or joined, including drafts and history.",
      };
    default:
      return {
        title: "Tournaments",
        description: "Browse penalty444 tournaments.",
      };
  }
}

function getEmptyMessage(filter: TournamentListFilter) {
  switch (filter) {
    case "active":
      return "No active tournaments right now. Try Registration or create one above.";
    case "registration":
      return "No tournaments are open for registration.";
    case "completed":
      return "No completed tournaments yet.";
    case "mine":
      return "You have not joined or hosted any tournaments yet.";
    default:
      return "No tournaments found.";
  }
}

type TournamentListPanelProps = {
  listVersion?: number;
};

export default function TournamentListPanel({
  listVersion = 0,
}: TournamentListPanelProps) {
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<
    Map<string, TournamentEntryRow[]>
  >(new Map());
  const [myEntriesByTournament, setMyEntriesByTournament] = useState<
    Map<string, TournamentEntryRow>
  >(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<TournamentListFilter>("active");

  const mountedRef = useRef(true);
  const fetchInFlightRef = useRef(false);
  const pendingSilentRefreshRef = useRef(false);
  const lastVisibilityRefreshAtRef = useRef(0);
  const hasDisplayedListRef = useRef(false);
  const tournamentsRef = useRef<TournamentRow[]>([]);

  tournamentsRef.current = tournaments;

  type TournamentListSnapshot = {
    tournaments: TournamentRow[];
    entriesByTournament: Map<string, TournamentEntryRow[]>;
    myEntriesByTournament: Map<string, TournamentEntryRow>;
    userId: string | null;
  };

  const applySnapshot = useCallback((snapshot: TournamentListSnapshot) => {
    setTournaments(snapshot.tournaments);
    setEntriesByTournament(snapshot.entriesByTournament);
    setMyEntriesByTournament(snapshot.myEntriesByTournament);
    setCurrentUserId(snapshot.userId);
    if (snapshot.tournaments.length > 0) {
      hasDisplayedListRef.current = true;
    }
  }, []);

  const loadTournaments = useCallback(async (options?: { silent?: boolean }) => {
    if (fetchInFlightRef.current) {
      if (options?.silent) {
        pendingSilentRefreshRef.current = true;
      }
      return;
    }

    fetchInFlightRef.current = true;
    pendingSilentRefreshRef.current = false;
    const silent = options?.silent === true;
    const hasExistingData =
      hasDisplayedListRef.current || tournamentsRef.current.length > 0;

    if (silent) {
      // Keep current list visible; no loading flags.
    } else if (!hasExistingData) {
      setIsInitialLoading(true);
    } else {
      setIsRefreshing(true);
    }

    if (!silent) {
      setError("");
    }

    try {
      const identity = await getCurrentPlayerIdentity();
      const userId = identity?.playerId ?? null;

      const { data: tournamentRows, error: tournamentError } = await supabase
        .from("tournaments")
        .select(
          "id, game_id, name, status, format, max_players, rounds_per_match, created_by, starts_at, created_at, winner_id, updated_at"
        )
        .eq("game_id", "penalty444")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });

      if (!mountedRef.current) {
        return;
      }

      if (tournamentError) {
        if (!silent) {
          setError(tournamentError.message);
          applySnapshot({
            tournaments: [],
            entriesByTournament: new Map(),
            myEntriesByTournament: new Map(),
            userId,
          });
        }
        return;
      }

      const nextTournaments = ((tournamentRows ?? []) as TournamentRow[]).filter(
        (row) => !isCancelledTournament(row.status)
      );

      logTournamentStatusTable(nextTournaments);

      if (nextTournaments.length === 0) {
        applySnapshot({
          tournaments: [],
          entriesByTournament: new Map(),
          myEntriesByTournament: new Map(),
          userId,
        });
        return;
      }

      const tournamentIds = nextTournaments.map((row) => row.id);

      const { data: entryRows, error: entriesError } = await supabase
        .from("tournament_entries")
        .select("id, tournament_id, user_id, username, status, checked_in_at")
        .in("tournament_id", tournamentIds);

      if (!mountedRef.current) {
        return;
      }

      if (entriesError) {
        if (!silent) {
          setError(entriesError.message);
          applySnapshot({
            tournaments: [],
            entriesByTournament: new Map(),
            myEntriesByTournament: new Map(),
            userId,
          });
        }
        return;
      }

      const nextEntriesByTournament = new Map<string, TournamentEntryRow[]>();
      const nextMyEntriesByTournament = new Map<string, TournamentEntryRow>();

      for (const row of (entryRows ?? []) as TournamentEntryRow[]) {
        const bucket = nextEntriesByTournament.get(row.tournament_id) ?? [];
        bucket.push(row);
        nextEntriesByTournament.set(row.tournament_id, bucket);

        if (userId && row.user_id === userId) {
          nextMyEntriesByTournament.set(row.tournament_id, row);
        }
      }

      applySnapshot({
        tournaments: nextTournaments,
        entriesByTournament: nextEntriesByTournament,
        myEntriesByTournament: nextMyEntriesByTournament,
        userId,
      });
    } finally {
      fetchInFlightRef.current = false;
      if (mountedRef.current) {
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }

      if (pendingSilentRefreshRef.current && mountedRef.current) {
        pendingSilentRefreshRef.current = false;
        void loadTournaments({ silent: true });
      }
    }
  }, [applySnapshot]);

  const refresh = useCallback(() => {
    void loadTournaments();
  }, [loadTournaments]);

  const refreshSilent = useCallback(() => {
    void loadTournaments({ silent: true });
  }, [loadTournaments]);

  useEffect(() => {
    mountedRef.current = true;
    void loadTournaments({ silent: hasDisplayedListRef.current });

    return () => {
      mountedRef.current = false;
    };
  }, [loadTournaments, listVersion]);

  const shouldPollLiveList = useMemo(
    () => tournaments.some((row) => isActiveTournament(row.status)),
    [tournaments]
  );

  useEffect(() => {
    if (filter !== "active") {
      return;
    }

    const completedOnActiveTab = tournaments.filter((row) =>
      isCompletedTournament(row.status)
    );

    if (completedOnActiveTab.length > 0) {
      console.warn(
        "[TournamentList] completed tournaments in source state while Active tab selected",
        completedOnActiveTab.map((row) => ({
          name: row.name,
          status: row.status,
          normalized: normalizeTournamentStatus(row.status),
        }))
      );
    }
  }, [filter, tournaments]);

  useEffect(() => {
    if (!shouldPollLiveList) {
      return;
    }

    const tick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      refreshSilent();
    };

    const intervalId = window.setInterval(tick, LIVE_LIST_POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastVisibilityRefreshAtRef.current < VISIBILITY_REFRESH_DEBOUNCE_MS) {
        return;
      }

      lastVisibilityRefreshAtRef.current = now;
      refreshSilent();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [shouldPollLiveList, refreshSilent]);

  const matchedForTab = filterTournamentsForTab(
    tournaments,
    filter,
    currentUserId,
    myEntriesByTournament
  );

  const filteredTournaments =
    filter === "completed"
      ? [...matchedForTab].sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
      : [...matchedForTab].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

  const sectionCopy = getSectionCopy(filter);
  const showInitialLoading = isInitialLoading && tournaments.length === 0;

  return (
    <section className="space-y-6 rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 shadow-2xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Events
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">
            {sectionCopy.title}
          </h2>
          <p className="mt-2 text-zinc-400">{sectionCopy.description}</p>
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={isInitialLoading || isRefreshing}
          className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-400 disabled:opacity-50"
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((option) => {
          const isSelected = filter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                isSelected
                  ? "border-amber-500/60 bg-amber-950/40 text-amber-100"
                  : "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {showInitialLoading ? (
        <p className="text-sm text-zinc-400">Loading tournaments...</p>
      ) : filteredTournaments.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-8 text-center text-sm text-zinc-400">
          {getEmptyMessage(filter)}
        </div>
      ) : (
        <ul className="space-y-4">
          {filteredTournaments.map((tournament) => {
            const entries = entriesByTournament.get(tournament.id) ?? [];
            const registeredCount = entries.filter(
              (entry) => entry.status !== "withdrawn"
            ).length;
            const myEntry = myEntriesByTournament.get(tournament.id) ?? null;
            const isHost =
              Boolean(currentUserId) &&
              currentUserId === tournament.created_by;
            const isLive =
              normalizeTournamentStatus(tournament.status) === "in_progress";
            const isActiveParticipant =
              myEntry != null &&
              (myEntry.status === "registered" ||
                myEntry.status === "checked_in");
            const showLiveAccess = isLive && (isHost || isActiveParticipant);
            const isCompleted = isCompletedTournament(tournament.status);
            const championUsername = resolveChampionUsername(
              tournament,
              entries
            );

            return (
              <li
                key={tournament.id}
                className={`rounded-2xl border p-5 ${
                  isCompleted
                    ? "border-zinc-700/80 bg-zinc-950/35"
                    : isHost
                      ? "border-amber-500/35 bg-zinc-950/60"
                      : "border-zinc-800 bg-zinc-950/60"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={`text-lg font-bold ${
                          isCompleted ? "text-zinc-200" : "text-white"
                        }`}
                      >
                        <Link
                          href={`/tournaments/${tournament.id}`}
                          className={
                            isCompleted
                              ? "hover:text-zinc-100"
                              : "hover:text-amber-200"
                          }
                        >
                          {tournament.name}
                        </Link>
                      </h3>
                      {isHost ? (
                        <span className="rounded-md border border-amber-500/50 bg-amber-950/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-200">
                          HOST: YOU
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      Single elimination · {tournament.rounds_per_match} rounds
                      per match
                    </p>
                  </div>

                  <span
                    className={`rounded-lg border px-2.5 py-1 text-xs font-bold tracking-wide ${statusBadgeClass(tournament.status)}`}
                  >
                    {formatTournamentStatus(tournament.status)}
                  </span>
                </div>

                {isCompleted ? (
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Champion
                      </dt>
                      <dd className="mt-1 font-semibold text-emerald-300/90">
                        {championUsername ?? "Champion TBD"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Completed
                      </dt>
                      <dd className="mt-1 font-semibold text-zinc-300">
                        {formatCompletedAt(tournament.updated_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Players
                      </dt>
                      <dd className="mt-1 font-semibold text-zinc-300">
                        {registeredCount}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Registered
                      </dt>
                      <dd className="mt-1 font-semibold text-white">
                        {registeredCount} / {tournament.max_players}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Starts
                      </dt>
                      <dd className="mt-1 font-semibold text-white">
                        {formatStartsAt(tournament.starts_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-zinc-500">
                        Format
                      </dt>
                      <dd className="mt-1 font-semibold capitalize text-white">
                        {tournament.format.replace("_", " ")}
                      </dd>
                    </div>
                  </dl>
                )}

                <div className="mt-4 border-t border-zinc-800 pt-4">
                  {isCompleted ? (
                    <Link
                      href={`/tournaments/${tournament.id}`}
                      className="inline-flex text-sm font-bold text-amber-300/90 hover:text-amber-200"
                    >
                      View Bracket →
                    </Link>
                  ) : (
                    <div className="space-y-4">
                      {showLiveAccess ? (
                        <div className="space-y-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-3 py-3">
                          {isActiveParticipant ? (
                            <>
                              <p className="text-sm font-semibold text-cyan-100">
                                Your tournament is live.
                              </p>
                              <p className="text-xs text-zinc-400">
                                Open the tournament page to play your bracket
                                match.
                              </p>
                            </>
                          ) : isHost ? (
                            <p className="text-xs text-amber-200/90">
                              Hosting — open the tournament page to manage and
                              play bracket matches.
                            </p>
                          ) : null}
                          <Link
                            href={`/tournaments/${tournament.id}`}
                            className="inline-flex rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-bold text-zinc-950 hover:from-amber-400 hover:to-orange-500"
                          >
                            Open Tournament
                          </Link>
                        </div>
                      ) : null}

                      <TournamentEntryActions
                        tournament={tournament}
                        currentUserId={currentUserId}
                        myEntry={myEntry}
                        registeredCount={registeredCount}
                        onUpdated={refresh}
                        showHostStrip={isHost && !isLive}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
