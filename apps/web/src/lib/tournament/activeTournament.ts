/**
 * Persistent active-tournament state (client-only, localStorage).
 *
 * Mirrors the activeMatch system: a single tournament can be marked "active"
 * for a given player so the app can always surface a clear Resume CTA after
 * refresh, tab close, or navigation away.
 *
 * No server writes, no realtime channel. The cached snapshot is treated as a
 * hint — actual tournament/entry rows are still the source of truth and the
 * snapshot is validated/cleared on every consumer read.
 */

export type ActiveTournamentState =
  | "registration"
  | "check_in"
  | "in_progress"
  | "unknown";

export type ActiveTournament = {
  tournamentId: string;
  tournamentName: string;
  playerId: string;
  lastKnownState: ActiveTournamentState;
  /** Display-only tier label (e.g. "Arena Cup"). */
  tierLabel?: string | null;
  savedAt: number;
};

const ACTIVE_TOURNAMENT_KEY = "penalty444_active_tournament";
/** Tournaments can be long; allow up to 24h of inactivity before purge. */
const ACTIVE_TOURNAMENT_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const ACTIVE_TOURNAMENT_EVENT = "penalty444:active-tournament-changed";

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined"
  );
}

function notifyActiveTournamentChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVE_TOURNAMENT_EVENT));
}

export function saveActiveTournament(payload: {
  tournamentId: string;
  tournamentName: string;
  playerId: string;
  lastKnownState: ActiveTournamentState;
  tierLabel?: string | null;
}): void {
  if (!isBrowser()) return;

  const tournamentId = payload.tournamentId?.trim();
  const playerId = payload.playerId?.trim();
  if (!tournamentId || !playerId) return;

  const next: ActiveTournament = {
    tournamentId,
    tournamentName: (payload.tournamentName ?? "").trim() || "Tournament",
    playerId,
    lastKnownState: payload.lastKnownState,
    tierLabel: payload.tierLabel ?? null,
    savedAt: Date.now(),
  };

  try {
    // Avoid write churn / unnecessary listener pings when nothing changed.
    const existing = window.localStorage.getItem(ACTIVE_TOURNAMENT_KEY);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as Partial<ActiveTournament>;
        if (
          parsed.tournamentId === next.tournamentId &&
          parsed.playerId === next.playerId &&
          parsed.lastKnownState === next.lastKnownState &&
          parsed.tournamentName === next.tournamentName &&
          parsed.tierLabel === next.tierLabel
        ) {
          // Refresh timestamp only — quiet update.
          window.localStorage.setItem(
            ACTIVE_TOURNAMENT_KEY,
            JSON.stringify({ ...next, savedAt: Date.now() })
          );
          return;
        }
      } catch {
        // fall through to overwrite below
      }
    }
    window.localStorage.setItem(ACTIVE_TOURNAMENT_KEY, JSON.stringify(next));
    notifyActiveTournamentChanged();
  } catch {
    // localStorage may be unavailable (quota / private mode); ignore — Resume
    // CTAs simply fall back to existing in-page state.
  }
}

export function getActiveTournament(
  expectedPlayerId?: string
): ActiveTournament | null {
  if (!isBrowser()) return null;

  const raw = window.localStorage.getItem(ACTIVE_TOURNAMENT_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ActiveTournament>;

    if (
      !parsed?.tournamentId ||
      !parsed?.playerId ||
      typeof parsed.savedAt !== "number"
    ) {
      clearActiveTournament();
      return null;
    }

    const expected = expectedPlayerId?.trim();
    if (expected && parsed.playerId.trim() !== expected) {
      clearActiveTournament();
      return null;
    }

    const isExpired =
      Date.now() - parsed.savedAt > ACTIVE_TOURNAMENT_MAX_AGE_MS;
    if (isExpired) {
      clearActiveTournament();
      return null;
    }

    return {
      tournamentId: parsed.tournamentId.trim(),
      tournamentName: (parsed.tournamentName ?? "").trim() || "Tournament",
      playerId: parsed.playerId.trim(),
      lastKnownState: (parsed.lastKnownState as ActiveTournamentState) ?? "unknown",
      tierLabel: parsed.tierLabel ?? null,
      savedAt: parsed.savedAt,
    };
  } catch {
    clearActiveTournament();
    return null;
  }
}

export function clearActiveTournament(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(ACTIVE_TOURNAMENT_KEY);
  notifyActiveTournamentChanged();
}

export function clearActiveTournamentIfPlayerMismatch(playerId: string): void {
  const normalized = playerId?.trim();
  if (!normalized) return;

  const active = getActiveTournament();
  if (!active) return;

  if (active.playerId !== normalized) {
    clearActiveTournament();
  }
}

/** Clear the snapshot if it points at the given tournament id (terminal state). */
export function clearActiveTournamentIfMatches(tournamentId: string): void {
  if (!tournamentId.trim()) return;
  const active = getActiveTournament();
  if (!active) return;
  if (active.tournamentId === tournamentId.trim()) {
    clearActiveTournament();
  }
}

/** Subscribe to active-tournament changes (returns an unsubscribe fn). */
export function subscribeActiveTournament(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(ACTIVE_TOURNAMENT_EVENT, handler);
  // Cross-tab support: also react to direct localStorage edits.
  const storageHandler = (event: StorageEvent) => {
    if (event.key === ACTIVE_TOURNAMENT_KEY) {
      listener();
    }
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(ACTIVE_TOURNAMENT_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
