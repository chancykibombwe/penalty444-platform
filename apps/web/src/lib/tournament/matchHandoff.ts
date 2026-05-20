/**
 * Lightweight sessionStorage handoff so the waiting room can pass tournament
 * context (round label, isFinal, opponent name) to the match room without
 * touching the server or the realtime payloads.
 *
 * The handoff is single-use: it is read once on match-room mount and then
 * removed. If absent, the match room falls back to generic copy.
 */

const KEY_PREFIX = "p444.tournamentMatchHandoff:";

export type TournamentMatchHandoff = {
  tournamentId: string;
  tournamentMatchId: string;
  roundLabel: string;
  isFinal: boolean;
  opponentName: string | null;
  /** ISO timestamp when the handoff was written. */
  writtenAt: number;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function storageKey(roomCode: string): string {
  return `${KEY_PREFIX}${roomCode.trim().toUpperCase()}`;
}

export function saveTournamentMatchHandoff(
  roomCode: string,
  payload: Omit<TournamentMatchHandoff, "writtenAt">
): void {
  if (!isBrowser() || !roomCode.trim()) return;

  try {
    window.sessionStorage.setItem(
      storageKey(roomCode),
      JSON.stringify({
        ...payload,
        writtenAt: Date.now(),
      } satisfies TournamentMatchHandoff)
    );
  } catch {
    // sessionStorage may be unavailable (private mode, quota); ignore — the
    // match room will simply fall back to generic intro copy.
  }
}

export function readTournamentMatchHandoff(
  roomCode: string
): TournamentMatchHandoff | null {
  if (!isBrowser() || !roomCode.trim()) return null;

  try {
    const raw = window.sessionStorage.getItem(storageKey(roomCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TournamentMatchHandoff>;
    if (
      typeof parsed?.tournamentId !== "string" ||
      typeof parsed?.roundLabel !== "string"
    ) {
      return null;
    }
    // Stale handoffs (> 10 min) are dropped to avoid wrong context on reconnect.
    if (
      typeof parsed.writtenAt === "number" &&
      Date.now() - parsed.writtenAt > 10 * 60 * 1000
    ) {
      return null;
    }
    return {
      tournamentId: parsed.tournamentId,
      tournamentMatchId: parsed.tournamentMatchId ?? "",
      roundLabel: parsed.roundLabel,
      isFinal: Boolean(parsed.isFinal),
      opponentName: parsed.opponentName ?? null,
      writtenAt: parsed.writtenAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearTournamentMatchHandoff(roomCode: string): void {
  if (!isBrowser() || !roomCode.trim()) return;
  try {
    window.sessionStorage.removeItem(storageKey(roomCode));
  } catch {
    // ignore
  }
}
