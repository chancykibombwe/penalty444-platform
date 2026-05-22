"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TournamentMatchRow } from "../../components/tournament/TournamentBracketPanel";
import type { TournamentEntryRow } from "../../components/tournament/TournamentListPanel";
import { useVisibleInterval } from "../polling/useVisibleInterval";
import {
  fetchTournamentDetail,
  type TournamentDetailFetchResult,
  type TournamentDetailRow,
} from "./fetchTournamentDetail";
import {
  POLL_INTERVAL_MS,
  shouldPollTournamentDetail,
  SILENT_RELOAD_DEBOUNCE_MS,
} from "./polling";

export type { TournamentDetailRow, TournamentDetailFetchResult };
export { fetchTournamentDetail } from "./fetchTournamentDetail";
export {
  isTournamentTerminal,
  shouldPollTournamentDetail,
  POLL_INTERVAL_MS,
  SILENT_RELOAD_DEBOUNCE_MS,
} from "./polling";

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

  // Sprint 2 TASK 6: visibility-aware polling for tournament detail. The
  // hook itself pauses on hidden tabs, runs an immediate tick on resume,
  // and stops entirely once the tournament reaches a terminal state.
  const pollingPaused = !shouldPollTournamentDetail(tournament, matches.length);

  useVisibleInterval(
    () => {
      scheduleSilentReload();
    },
    {
      intervalMs: POLL_INTERVAL_MS,
      paused: pollingPaused,
      runImmediately: false,
      deps: [scheduleSilentReload, pollingPaused],
    }
  );

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
