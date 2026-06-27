/**
 * Player Challenge link helpers (v1).
 *
 * Pure string helpers for the leaderboard → lobby → private-room challenge
 * flow. No sockets, gameplay, wallet, or auth logic here — just URL/text
 * construction. Usernames are URL-encoded; raw auth ids are never required.
 */

/** Route to the lobby with a challenge target (canonical simple form). */
export function buildChallengeHref(username: string): string {
  return `/lobby?challenge=${encodeURIComponent(username.trim())}`;
}

/**
 * Resolve the challenge target username from lobby query params. Supports
 * both the canonical `?challenge=<username>` and the legacy
 * `?challengeUsername=<name>` form so existing links keep working.
 */
export function resolveChallengeTarget(params: {
  challenge?: string | null;
  challengeUsername?: string | null;
}): string {
  const legacy = params.challengeUsername?.trim() ?? "";
  if (legacy.length > 0) return legacy;
  return params.challenge?.trim() ?? "";
}

/** Lobby path that prefills the Join Room input with a code. */
export function buildJoinPath(roomCode: string): string {
  return `/lobby?join=${encodeURIComponent(roomCode.trim().toUpperCase())}`;
}

/**
 * Absolute join link for sharing. Uses the provided origin, else the live
 * browser origin. Falls back to a relative path when no origin is available
 * (e.g. SSR) so callers always get a usable string.
 */
export function buildJoinLink(roomCode: string, origin?: string): string {
  const base =
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const path = buildJoinPath(roomCode);
  return base ? `${base}${path}` : path;
}

/**
 * Copyable invite message. Beta-safe: "free match", no money / stakes /
 * prizes. The challenged player is NOT auto-notified — the inviter shares
 * this text manually.
 */
export function buildInviteText(options: {
  challengerName?: string | null;
  roomCode: string;
  joinLink?: string | null;
}): string {
  const code = options.roomCode.trim().toUpperCase();
  const challenger = (options.challengerName ?? "").trim();
  const who = challenger.length > 0 ? challenger : "A player";
  const base = `${who} challenged you to a free Penalty444 match on 444 ARENA. Join with room code: ${code}`;
  const link = options.joinLink?.trim();
  return link ? `${base}\n${link}` : base;
}
