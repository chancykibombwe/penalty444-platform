export type ActiveMatch = {
  roomCode: string;
  playerId: string;
  savedAt: number;
};

const ACTIVE_MATCH_KEY = "penalty444_active_match";
const ACTIVE_MATCH_MAX_AGE_MS = 1000 * 60 * 60 * 2; // 2 hours

function notifyActiveMatchChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("penalty444:active-match-changed"));
}

export function saveActiveMatch(roomCode: string, playerId?: string) {
  if (typeof window === "undefined") return;

  const code = roomCode.trim().toUpperCase();
  if (!code) return;

  const normalizedPlayerId = playerId?.trim();
  if (!normalizedPlayerId) {
    return;
  }

  window.localStorage.setItem(
    ACTIVE_MATCH_KEY,
    JSON.stringify({
      roomCode: code,
      playerId: normalizedPlayerId,
      savedAt: Date.now(),
    } satisfies ActiveMatch)
  );

  notifyActiveMatchChanged();
}

export function getActiveMatch(expectedPlayerId?: string): ActiveMatch | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(ACTIVE_MATCH_KEY);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ActiveMatch>;

    if (!parsed.roomCode || !parsed.savedAt) {
      clearActiveMatch();
      return null;
    }

    if (!parsed.playerId?.trim()) {
      clearActiveMatch();
      return null;
    }

    const normalizedExpected = expectedPlayerId?.trim();
    if (
      normalizedExpected &&
      parsed.playerId.trim() !== normalizedExpected
    ) {
      clearActiveMatch();
      return null;
    }

    const isExpired = Date.now() - parsed.savedAt > ACTIVE_MATCH_MAX_AGE_MS;

    if (isExpired) {
      clearActiveMatch();
      return null;
    }

    return {
      roomCode: parsed.roomCode.trim().toUpperCase(),
      playerId: parsed.playerId.trim(),
      savedAt: parsed.savedAt,
    };
  } catch {
    clearActiveMatch();
    return null;
  }
}

export function clearActiveMatchIfPlayerMismatch(playerId: string): void {
  const normalized = playerId.trim();
  if (!normalized) return;

  const active = getActiveMatch();
  if (!active) return;

  if (active.playerId !== normalized) {
    clearActiveMatch();
  }
}

export function clearActiveMatch() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(ACTIVE_MATCH_KEY);
  notifyActiveMatchChanged();
}
