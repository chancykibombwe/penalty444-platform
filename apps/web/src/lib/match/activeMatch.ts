export type ActiveMatch = {
  roomCode: string;
  savedAt: number;
};

const ACTIVE_MATCH_KEY = "penalty444_active_match";
const ACTIVE_MATCH_MAX_AGE_MS = 1000 * 60 * 60 * 2; // 2 hours

function notifyActiveMatchChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("penalty444:active-match-changed"));
}

export function saveActiveMatch(roomCode: string) {
  if (typeof window === "undefined") return;

  const code = roomCode.trim().toUpperCase();
  if (!code) return;

  window.localStorage.setItem(
    ACTIVE_MATCH_KEY,
    JSON.stringify({
      roomCode: code,
      savedAt: Date.now(),
    })
  );

  notifyActiveMatchChanged();
}

export function getActiveMatch(): ActiveMatch | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(ACTIVE_MATCH_KEY);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ActiveMatch;

    if (!parsed.roomCode || !parsed.savedAt) {
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
      savedAt: parsed.savedAt,
    };
  } catch {
    clearActiveMatch();
    return null;
  }
}

export function clearActiveMatch() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(ACTIVE_MATCH_KEY);
  notifyActiveMatchChanged();
}