import type { TournamentDetailRow } from "./fetchTournamentDetail";

export const POLL_INTERVAL_MS = 5000;
export const SILENT_RELOAD_DEBOUNCE_MS = 400;

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
