"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase/client";
import { getCurrentPlayerIdentity } from "../../lib/auth/playerIdentity";
import { getSocket } from "../../lib/socket/client";
import {
  clearActiveTournament,
  clearActiveTournamentIfMatches,
  getActiveTournament,
} from "../../lib/tournament/activeTournament";
import {
  getTournamentStateBadge,
  getTournamentTier,
} from "../../lib/tournament/tournamentBranding";
import TournamentEmptyState from "./TournamentEmptyState";
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

/**
 * Public-facing tab ids (Phase 3 hub taxonomy).
 *
 * Mapping vs. older terminology:
 *   - `live`      → tournament status === in_progress (subset of legacy "active")
 *   - `upcoming`  → registration + check_in (legacy "registration" tab)
 *   - `my`        → user is a participant or host (legacy "mine")
 *   - `completed` → tournament status === completed
 */
export type TournamentListFilter = "live" | "upcoming" | "my" | "completed";

const FILTER_OPTIONS: { id: TournamentListFilter; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
  { id: "my", label: "My Tournaments" },
  { id: "completed", label: "Completed" },
];

const ACTIVE_STATUSES = new Set(["registration", "check_in", "in_progress"]);
const REGISTRATION_STATUSES = new Set(["registration", "check_in"]);
const LIVE_STATUSES = new Set(["in_progress"]);
const LIVE_LIST_POLL_INTERVAL_MS = 12_000;
/** Faster polling when this user has a persistent active tournament. */
const ACTIVE_TOURNAMENT_POLL_INTERVAL_MS = 6_000;
const VISIBILITY_REFRESH_DEBOUNCE_MS = 2_000;
/** Debounce window for socket reconnect / focus refreshes. */
const RECONNECT_REFRESH_DEBOUNCE_MS = 1_500;

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

function isLiveTabStatus(status: string | null | undefined): boolean {
  return LIVE_STATUSES.has(normalizeTournamentStatus(status));
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
      return "Starting soon";
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
      filter !== "my"
    ) {
      return false;
    }

    switch (filter) {
      case "live":
        return isLiveTabStatus(tournament.status);
      case "upcoming":
        return isRegistrationTabStatus(tournament.status);
      case "completed":
        return isCompletedTournament(tournament.status);
      case "my":
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
    case "live":
      return {
        eyebrow: "Events",
        title: "Live Now",
        description: "Brackets in progress. Jump in or follow the action.",
      };
    case "upcoming":
      return {
        eyebrow: "Events",
        title: "Upcoming",
        description: "Registration is open — join now before the host starts.",
      };
    case "completed":
      return {
        eyebrow: "History",
        title: "Completed",
        description: "Past champions and finished brackets.",
      };
    case "my":
      return {
        eyebrow: "Your roster",
        title: "My Tournaments",
        description: "Events you host or joined — still in play.",
      };
    default:
      return {
        eyebrow: "Events",
        title: "Tournaments",
        description: "Browse penalty444 tournaments.",
      };
  }
}

type EmptyCopy = {
  tone: "live" | "upcoming" | "mine" | "completed" | "neutral";
  eyebrow: string;
  headline: string;
  subtext: string;
};

function getEmptyCopy(filter: TournamentListFilter): EmptyCopy {
  switch (filter) {
    case "live":
      return {
        tone: "live",
        eyebrow: "Live arena",
        headline: "No live events right now — upcoming battles are loading.",
        subtext: "Check Upcoming or host one — the arena never sleeps for long.",
      };
    case "upcoming":
      return {
        tone: "upcoming",
        eyebrow: "Lobby",
        headline: "Preparing the next arena…",
        subtext: "Waiting for challengers — be the first to host or join.",
      };
    case "completed":
      return {
        tone: "completed",
        eyebrow: "Hall of champions",
        headline: "First champion incoming.",
        subtext: "Finish a bracket and the trophy lands here.",
      };
    case "my":
      return {
        tone: "mine",
        eyebrow: "Your roster",
        headline: "Join your first tournament.",
        subtext: "Pick one from Upcoming or Live — your roster fills as you compete.",
      };
    default:
      return {
        tone: "neutral",
        eyebrow: "Events",
        headline: "Preparing the next arena…",
        subtext: "",
      };
  }
}

import type { TournamentHubStats } from "./TournamentHubHero";

type TournamentListPanelProps = {
  listVersion?: number;
  /**
   * Optional active-tournament id from the localStorage snapshot. When this
   * matches a fetched row the card is pinned to the top and the Resume CTA is
   * elevated. The panel also runs stale-cleanup against fetched rows.
   */
  activeTournamentId?: string | null;
  /** Default selected tab (defaults to `live`). */
  defaultFilter?: TournamentListFilter;
  /** Emits aggregated counts whenever the fetched data changes. */
  onStatsChanged?: (stats: TournamentHubStats) => void;
  /** Emits the loading state so external hero stats can mirror it. */
  onLoadingChanged?: (loading: boolean) => void;
};

export default function TournamentListPanel({
  listVersion = 0,
  activeTournamentId = null,
  defaultFilter = "live",
  onStatsChanged,
  onLoadingChanged,
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
  const [filter, setFilter] = useState<TournamentListFilter>(defaultFilter);

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
    if (filter !== "live") {
      return;
    }

    const completedOnLiveTab = tournaments.filter((row) =>
      isCompletedTournament(row.status)
    );

    if (completedOnLiveTab.length > 0) {
      console.warn(
        "[TournamentList] completed tournaments in source state while Live tab selected",
        completedOnLiveTab.map((row) => ({
          name: row.name,
          status: row.status,
          normalized: normalizeTournamentStatus(row.status),
        }))
      );
    }
  }, [filter, tournaments]);

  // Emit aggregated tab counts upstream so the hero stats can mirror them.
  useEffect(() => {
    if (!onStatsChanged) return;

    let live = 0;
    let upcoming = 0;
    let completed = 0;
    let mine = 0;

    for (const row of tournaments) {
      if (isCancelledTournament(row.status)) continue;
      const normalized = normalizeTournamentStatus(row.status);
      if (normalized === "in_progress") live += 1;
      else if (normalized === "registration" || normalized === "check_in")
        upcoming += 1;
      else if (normalized === "completed") completed += 1;

      if (
        currentUserId &&
        normalized !== "cancelled" &&
        normalized !== "completed" &&
        (row.created_by === currentUserId ||
          myEntriesByTournament.has(row.id))
      ) {
        mine += 1;
      }
    }

    onStatsChanged({ live, upcoming, mine, completed });
  }, [tournaments, currentUserId, myEntriesByTournament, onStatsChanged]);

  useEffect(() => {
    onLoadingChanged?.(isInitialLoading && tournaments.length === 0);
  }, [isInitialLoading, tournaments.length, onLoadingChanged]);

  // Faster polling cadence when the user has a persistent active tournament
  // in the list — that's the row they care about most after refresh/reopen.
  const hasActiveTournamentInList = useMemo(() => {
    if (!activeTournamentId) return false;
    return tournaments.some(
      (row) => row.id === activeTournamentId && isActiveTournament(row.status)
    );
  }, [tournaments, activeTournamentId]);

  useEffect(() => {
    if (!shouldPollLiveList) {
      return;
    }

    const intervalMs = hasActiveTournamentInList
      ? ACTIVE_TOURNAMENT_POLL_INTERVAL_MS
      : LIVE_LIST_POLL_INTERVAL_MS;

    if (process.env.NODE_ENV !== "production") {
      console.info(
        "[TournamentListRefresh] poll interval",
        intervalMs,
        "ms (activeInList:",
        hasActiveTournamentInList,
        ")"
      );
    }

    const tick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      refreshSilent();
    };

    const intervalId = window.setInterval(tick, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastVisibilityRefreshAtRef.current < VISIBILITY_REFRESH_DEBOUNCE_MS) {
        return;
      }

      lastVisibilityRefreshAtRef.current = now;
      if (process.env.NODE_ENV !== "production") {
        console.info("[TournamentListRefresh] visibility → refresh");
      }
      refreshSilent();
    };

    const handleFocus = () => {
      const now = Date.now();
      if (now - lastVisibilityRefreshAtRef.current < VISIBILITY_REFRESH_DEBOUNCE_MS) {
        return;
      }
      lastVisibilityRefreshAtRef.current = now;
      if (process.env.NODE_ENV !== "production") {
        console.info("[TournamentListRefresh] window focus → refresh");
      }
      refreshSilent();
    };

    // Socket reconnect should also refresh the list — same logic the dev
    // schedule sync uses, but without depending on the dev flag.
    const socket = getSocket();
    let lastSocketRefreshAt = 0;
    const handleSocketConnect = () => {
      const now = Date.now();
      if (now - lastSocketRefreshAt < RECONNECT_REFRESH_DEBOUNCE_MS) {
        return;
      }
      lastSocketRefreshAt = now;
      if (process.env.NODE_ENV !== "production") {
        console.info("[TournamentListRefresh] socket reconnect → refresh");
      }
      refreshSilent();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    socket.on("connect", handleSocketConnect);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      socket.off("connect", handleSocketConnect);
    };
  }, [shouldPollLiveList, refreshSilent, hasActiveTournamentInList]);

  const matchedForTab = filterTournamentsForTab(
    tournaments,
    filter,
    currentUserId,
    myEntriesByTournament
  );

  const baseSortedTournaments =
    filter === "completed"
      ? [...matchedForTab].sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
      : [...matchedForTab].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

  // Pin the active tournament to the top so the user always lands on the
  // session they're already part of.
  const filteredTournaments = useMemo(() => {
    if (!activeTournamentId) return baseSortedTournaments;
    const index = baseSortedTournaments.findIndex(
      (t) => t.id === activeTournamentId
    );
    if (index <= 0) return baseSortedTournaments;
    const next = [...baseSortedTournaments];
    const [pinned] = next.splice(index, 1);
    next.unshift(pinned);
    return next;
  }, [baseSortedTournaments, activeTournamentId]);

  // Stale-cleanup: if the snapshot still references a tournament we just
  // confirmed is completed / cancelled / withdrawn, drop the snapshot. This
  // prevents Resume CTAs from clinging to dead sessions across refreshes.
  useEffect(() => {
    if (!activeTournamentId) return;
    if (tournaments.length === 0) return;

    const snapshot = getActiveTournament(currentUserId ?? undefined);
    if (!snapshot) return;
    if (snapshot.tournamentId !== activeTournamentId) return;

    const fresh = tournaments.find((t) => t.id === activeTournamentId);
    if (!fresh) {
      // Could be filtered (cancelled rows are excluded from fetch).
      clearActiveTournamentIfMatches(activeTournamentId);
      return;
    }

    const normalizedStatus = normalizeTournamentStatus(fresh.status);
    if (
      normalizedStatus === "completed" ||
      normalizedStatus === "cancelled"
    ) {
      clearActiveTournamentIfMatches(activeTournamentId);
      return;
    }

    if (!currentUserId) return;
    const myEntry = myEntriesByTournament.get(activeTournamentId);
    if (!myEntry || myEntry.status === "withdrawn") {
      // The user isn't in this tournament anymore — drop the snapshot.
      clearActiveTournament();
    }
  }, [
    activeTournamentId,
    tournaments,
    myEntriesByTournament,
    currentUserId,
  ]);

  const sectionCopy = getSectionCopy(filter);
  const emptyCopy = getEmptyCopy(filter);
  const showInitialLoading = isInitialLoading && tournaments.length === 0;

  return (
    <section className="space-y-5 rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-4 shadow-2xl sm:space-y-6 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:items-end sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500 sm:text-xs">
            {sectionCopy.eyebrow}
          </p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-white sm:mt-2 sm:text-2xl">
            {sectionCopy.title}
          </h2>
          <p className="mt-1 text-sm text-zinc-400 sm:mt-2 sm:text-base">
            {sectionCopy.description}
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={isInitialLoading || isRefreshing}
          className="shrink-0 rounded-xl border border-zinc-600 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-400 disabled:opacity-50 sm:px-4 sm:text-sm"
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Tournament filter"
        className="flex flex-wrap gap-2"
      >
        {FILTER_OPTIONS.map((option) => {
          const isSelected = filter === option.id;
          const isCompetitive = option.id === "live";
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setFilter(option.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors ${
                isSelected
                  ? isCompetitive
                    ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.25)]"
                    : "border-amber-400/60 bg-amber-500/15 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.22)]"
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
        <TournamentEmptyState
          tone="neutral"
          eyebrow="Loading"
          headline="Preparing the next arena…"
          subtext="Fetching live events."
        />
      ) : filteredTournaments.length === 0 ? (
        <TournamentEmptyState
          tone={emptyCopy.tone}
          eyebrow={emptyCopy.eyebrow}
          headline={emptyCopy.headline}
          subtext={emptyCopy.subtext}
        />
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
            const tier = getTournamentTier(tournament.max_players);
            const stateBadge = getTournamentStateBadge(tournament.status, {
              hasChampion: Boolean(championUsername),
            });
            const isActiveForMe =
              Boolean(activeTournamentId) &&
              tournament.id === activeTournamentId;

            return (
              <li
                key={tournament.id}
                className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 ${
                  isActiveForMe
                    ? "border-2 border-cyan-300/65 bg-gradient-to-br from-cyan-950/40 via-zinc-950 to-black shadow-2xl shadow-cyan-950/40 ring-2 ring-cyan-400/30"
                    : isCompleted
                      ? "border-yellow-300/30 bg-gradient-to-br from-yellow-950/15 via-zinc-950/55 to-black"
                      : isLive
                        ? `border-cyan-500/40 bg-gradient-to-br from-cyan-950/25 via-zinc-950/60 to-black ${tier.glowClass}`
                        : isHost
                          ? "border-amber-500/35 bg-zinc-950/60"
                          : `border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/60 to-black ring-1 ${tier.ringClass}`
                }`}
              >
                {isActiveForMe ? (
                  <span className="absolute left-4 top-0 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-cyan-300/65 bg-cyan-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.35)]">
                    <span
                      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                      aria-hidden
                    />
                    Active for you
                  </span>
                ) : null}
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -top-20 -right-20 h-40 w-40 rounded-full blur-3xl opacity-25 ${
                    isLive
                      ? "bg-cyan-500/40"
                      : isCompleted
                        ? "bg-yellow-500/25"
                        : tier.id === "elite"
                          ? "bg-fuchsia-500/25"
                          : tier.id === "major"
                            ? "bg-orange-500/20"
                            : tier.id === "arena"
                              ? "bg-amber-500/20"
                              : tier.id === "knockout"
                                ? "bg-cyan-500/15"
                                : "bg-sky-500/15"
                  }`}
                />

                <div className="relative flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${tier.pillClass}`}
                      >
                        {tier.shortLabel}
                      </span>
                      <span className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-900/70 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-300">
                        {tier.capacityLabel}
                      </span>
                      {isHost ? (
                        <span className="inline-flex items-center rounded-md border border-amber-500/50 bg-amber-950/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-200">
                          Host: You
                        </span>
                      ) : null}
                    </div>
                    <h3
                      className={`mt-2 break-words text-base font-black tracking-tight sm:text-lg ${
                        isCompleted
                          ? "bg-gradient-to-r from-yellow-200 via-amber-200 to-yellow-100 bg-clip-text text-transparent"
                          : "text-white"
                      }`}
                    >
                      <Link
                        href={`/tournaments/${tournament.id}`}
                        className={
                          isCompleted
                            ? "hover:opacity-90"
                            : "hover:text-amber-200"
                        }
                      >
                        {tournament.name}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {tier.subtitle} · {tournament.rounds_per_match} rounds
                      per match
                    </p>
                  </div>

                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${stateBadge.className}`}
                  >
                    {stateBadge.pulse ? (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-90" />
                    ) : null}
                    {stateBadge.label}
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
                        <div className="space-y-2 rounded-xl border border-cyan-500/35 bg-cyan-950/25 px-3 py-3 shadow-[0_0_18px_rgba(34,211,238,0.12)]">
                          <p className="inline-flex items-center gap-2 text-sm font-bold text-cyan-100">
                            <span
                              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                              aria-hidden
                            />
                            {isActiveParticipant
                              ? "Your tournament is live"
                              : isHost
                                ? "Tournament is live"
                                : "Live tournament"}
                          </p>
                          <p className="text-xs text-zinc-400">
                            {isActiveParticipant
                              ? "Resume to play your next bracket match."
                              : isHost
                                ? "Resume to manage and play bracket matches."
                                : "Open the tournament page for bracket access."}
                          </p>
                          <Link
                            href={`/tournaments/${tournament.id}`}
                            className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-amber-500 px-4 py-3 text-sm font-black text-zinc-950 shadow-lg hover:from-cyan-400 hover:to-amber-400 sm:w-auto sm:py-2"
                          >
                            Resume Tournament →
                          </Link>
                        </div>
                      ) : isActiveParticipant ? (
                        <div className="space-y-2 rounded-xl border border-amber-500/35 bg-amber-950/25 px-3 py-3">
                          <p className="text-sm font-bold text-amber-100">
                            You&apos;re in — Tournament Lobby
                          </p>
                          <p className="text-xs text-amber-100/80">
                            You&apos;re registered. Waiting for the host to
                            start the tournament.
                          </p>
                          <Link
                            href={`/tournaments/${tournament.id}`}
                            className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 text-sm font-black text-zinc-950 hover:from-amber-400 hover:to-orange-500 sm:w-auto sm:py-2"
                          >
                            Enter Tournament Lobby →
                          </Link>
                        </div>
                      ) : null}

                      {showLiveAccess || !isActiveParticipant ? (
                        <TournamentEntryActions
                          tournament={tournament}
                          currentUserId={currentUserId}
                          myEntry={myEntry}
                          registeredCount={registeredCount}
                          onUpdated={refresh}
                          showHostStrip={isHost && !isLive}
                          redirectToLobbyOnJoin
                        />
                      ) : null}
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
