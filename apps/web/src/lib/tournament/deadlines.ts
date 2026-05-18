const DEFAULT_MATCH_JOIN_MS = 15 * 60 * 1000;
const DEFAULT_OPPONENT_JOIN_MS = 5 * 60 * 1000;

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Deadline for both players to open a ready match (env override: TOURNAMENT_MATCH_JOIN_MS). */
export const TOURNAMENT_MATCH_JOIN_MS =
  parsePositiveInt(process.env.TOURNAMENT_MATCH_JOIN_MS) ?? DEFAULT_MATCH_JOIN_MS;

/** ISO timestamp when a ready match must be opened by (now + join window). */
export function computePlayBy(now: Date = new Date()): string {
  return new Date(now.getTime() + TOURNAMENT_MATCH_JOIN_MS).toISOString();
}

/** Deadline for the missing opponent after first presence (env: TOURNAMENT_OPPONENT_JOIN_MS). */
export const TOURNAMENT_OPPONENT_JOIN_MS =
  parsePositiveInt(process.env.TOURNAMENT_OPPONENT_JOIN_MS) ??
  DEFAULT_OPPONENT_JOIN_MS;

/** ISO timestamp when the absent opponent must appear (now + opponent join window). */
export function computeOpponentJoinBy(now: Date = new Date()): string {
  return new Date(now.getTime() + TOURNAMENT_OPPONENT_JOIN_MS).toISOString();
}
