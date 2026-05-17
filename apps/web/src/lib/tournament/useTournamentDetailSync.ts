"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TournamentMatchRow } from "../../components/tournament/TournamentBracketPanel";
import type {
  TournamentEntryRow,
  TournamentRow,
} from "../../components/tournament/TournamentListPanel";
import { getCurrentPlayerIdentity } from "../auth/playerIdentity";
import { supabase } from "../supabase/client";

export type TournamentDetailRow = TournamentRow & {
  winner_id: string | null;
};

const POLL_INTERVAL_MS = 5000;
const SILENT_RELOAD_DEBOUNCE_MS = 400;

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

export function isTournamentTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function shouldPollTournamentDetail(
  tournament: TournamentDetailRow | null,
  matchCount: number
): boolean {
  if (!tournament || isTournamentTerminal(tournament.status)) {
    return false;
  }

  return tournament.status === "in_progress" || matchCount > 0;
}

export type TournamentDetailFetchResult =
  | {
      ok: true;
      tournament: TournamentDetailRow;
      entries: TournamentEntryRow[];
      matches: TournamentMatchRow[];
      creatorUsername: string | null;
      currentUserId: string | null;
    }
  | {
      ok: false;
      error: string;
    };

export async function fetchTournamentDetail(
  tournamentId: string
): Promise<TournamentDetailFetchResult> {
  if (!tournamentId) {
    return { ok: false, error: "Missing tournament id." };
  }

  const identity = await getCurrentPlayerIdentity();

  const { data: tournamentRow, error: tournamentError } = await supabase
    .from("tournaments")
    .select(
      "id, game_id, name, status, format, max_players, rounds_per_match, created_by, starts_at, created_at, winner_id"
    )
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentError) {
    return { ok: false, error: tournamentError.message };
  }

  if (!tournamentRow) {
    return { ok: false, error: "Tournament not found." };
  }

  const [entriesResult, matchesResult] = await Promise.all([
    supabase
      .from("tournament_entries")
      .select("id, tournament_id, user_id, username, status, checked_in_at")
      .eq("tournament_id", tournamentId)
      .order("checked_in_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("tournament_matches")
      .select(
        "id, tournament_id, round_number, slot_index, entry_one_id, entry_two_id, room_code, status, winner_entry_id, next_match_id"
      )
      .eq("tournament_id", tournamentId)
      .order("round_number", { ascending: true })
      .order("slot_index", { ascending: true }),
  ]);

  if (entriesResult.error) {
    return { ok: false, error: entriesResult.error.message };
  }

  if (matchesResult.error) {
    return { ok: false, error: matchesResult.error.message };
  }

  const tournament = tournamentRow as TournamentDetailRow;
  const currentUserId = identity?.playerId ?? null;

  let creatorUsername: string | null = null;
  const isViewerHost =
    currentUserId != null && currentUserId === tournament.created_by;

  if (!isViewerHost) {
    const { data: creatorProfile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", tournament.created_by)
      .maybeSingle();
    creatorUsername = creatorProfile?.username ?? null;
  }

  return {
    ok: true,
    tournament,
    entries: (entriesResult.data ?? []) as TournamentEntryRow[],
    matches: (matchesResult.data ?? []) as TournamentMatchRow[],
    creatorUsername,
    currentUserId,
  };
}

export function useTournamentDetailSync(tournamentId: string) {
  const [tournament, setTournament] = useState<TournamentDetailRow | null>(null);
  const [entries, setEntries] = useState<TournamentEntryRow[]>([]);
  const [matches, setMatches] = useState<TournamentMatchRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [creatorUsername, setCreatorUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyFetchResult = useCallback((result: TournamentDetailFetchResult) => {
    if (!result.ok) {
      return false;
    }

    setTournament(result.tournament);
    setEntries(result.entries);
    setMatches(result.matches);
    setCurrentUserId(result.currentUserId);
    setCreatorUsername(result.creatorUsername);
    return true;
  }, []);

  const loadSilent = useCallback(async () => {
    if (!tournamentId) return;

    const result = await fetchTournamentDetail(tournamentId);

    if (result.ok) {
      applyFetchResult(result);
    }
  }, [tournamentId, applyFetchResult]);

  const scheduleSilentReload = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void loadSilent();
    }, SILENT_RELOAD_DEBOUNCE_MS);
  }, [loadSilent]);

  const refresh = useCallback(() => {
    scheduleSilentReload();
  }, [scheduleSilentReload]);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch when route id changes; setState only runs here (not in poll/visibility paths).
    /* eslint-disable react-hooks/set-state-in-effect -- mount/id-change bootstrap */
    if (!tournamentId) {
      setError("Missing tournament id.");
      setLoading(false);
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      };
    }

    setLoading(true);
    setError("");
    setCreatorUsername(null);

    void fetchTournamentDetail(tournamentId).then((result) => {
      if (cancelled) return;

      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }

      applyFetchResult(result);
      setLoading(false);
    });
    /* eslint-enable react-hooks/set-state-in-effect */

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [tournamentId, applyFetchResult]);

  useEffect(() => {
    if (!shouldPollTournamentDetail(tournament, matches.length)) {
      return;
    }

    const tick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      scheduleSilentReload();
    };

    const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [tournament, matches.length, scheduleSilentReload]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (!shouldPollTournamentDetail(tournament, matches.length)) {
        return;
      }
      scheduleSilentReload();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [tournament, matches.length, scheduleSilentReload]);

  return {
    tournament,
    entries,
    matches,
    currentUserId,
    creatorUsername,
    loading,
    error,
    refresh,
    scheduleSilentReload,
  };
}
