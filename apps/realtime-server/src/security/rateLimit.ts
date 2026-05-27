/**
 * Hardening Sprint 4 — TASK 13: lightweight in-memory rate limiter for
 * sensitive socket actions.
 *
 * Uses a sliding-window counter per `(socketId, action)` pair. We keep
 * timestamps of the last N hits and reject when the window is full.
 *
 * Defaults are chosen to be invisible during normal gameplay:
 *
 *   - `match:pick`            : 6 hits / 10 s   (1 pick per round + retry slack)
 *   - `match:rematch`         : 4 hits / 10 s
 *   - `match:rematch:decline` : 4 hits / 10 s
 *   - `publicOffer:create`    : 5 hits / 30 s
 *   - `publicOffer:join`      : 10 hits / 30 s
 *   - `publicOffer:cancel`    : 10 hits / 30 s
 *   - `room:create`           : 6 hits / 30 s
 *   - `room:join`             : 30 hits / 30 s  (permissive — reconnect spam)
 *   - `ranked:enqueue`        : 10 hits / 60 s
 *
 * Callers wrap the handler with `if (!allowSocketAction(socket.id, "...")) return;`.
 *
 * Cleanup: timestamps older than the window are pruned on every check.
 * On `disconnect`, the realtime server calls `pruneRateLimitForSocket`
 * to drop residual entries.
 *
 * No external dependency. Resets across restart are fine — abuse
 * patterns we care about (one-machine flooders) are short-lived.
 */

type ActionLimit = {
  limit: number;
  windowMs: number;
};

const DEFAULT_LIMITS: Record<string, ActionLimit> = {
  "match:pick": { limit: 6, windowMs: 10_000 },
  "match:rematch": { limit: 4, windowMs: 10_000 },
  "match:rematch:decline": { limit: 4, windowMs: 10_000 },
  "match:forfeit": { limit: 4, windowMs: 10_000 },
  "match:abortEarly": { limit: 4, windowMs: 10_000 },
  "publicOffer:create": { limit: 5, windowMs: 30_000 },
  "publicOffer:join": { limit: 10, windowMs: 30_000 },
  "publicOffer:cancel": { limit: 10, windowMs: 30_000 },
  "room:create": { limit: 6, windowMs: 30_000 },
  "room:join": { limit: 30, windowMs: 30_000 },
  "ranked:enqueue": { limit: 10, windowMs: 60_000 },
  // Phase 6C — presence signals. Legitimate clients fire one
  // `player:present` per `MatchRoomPanel` mount and one
  // `player:leave` per unmount; allow some slack for reconnects
  // and tab refresh storms but stay tight enough to block flooders
  // from spoofing readiness re-evaluations.
  "player:present": { limit: 10, windowMs: 30_000 },
  "player:leave": { limit: 10, windowMs: 30_000 },
};

const FALLBACK_LIMIT: ActionLimit = { limit: 30, windowMs: 60_000 };

const buckets = new Map<string, number[]>();

function bucketKey(socketId: string, action: string): string {
  return `${socketId}::${action}`;
}

function limitFor(action: string): ActionLimit {
  return DEFAULT_LIMITS[action] ?? FALLBACK_LIMIT;
}

/**
 * Returns true if the action is allowed; false (and logs `[Security]
 * rate limit exceeded ...`) when the bucket is full.
 *
 * Side effect: records the timestamp on success.
 */
export function allowSocketAction(
  socketId: string,
  action: string,
  context: { roomCode?: string; playerId?: string } = {}
): boolean {
  if (!socketId || !action) return true;

  const limit = limitFor(action);
  const now = Date.now();
  const cutoff = now - limit.windowMs;
  const key = bucketKey(socketId, action);
  const list = (buckets.get(key) ?? []).filter((ts) => ts >= cutoff);

  if (list.length >= limit.limit) {
    buckets.set(key, list);
    console.warn(
      `[Security] rate limit exceeded action=${action} socketId=${socketId} ` +
        `roomCode=${context.roomCode ?? "—"} playerId=${context.playerId ?? "—"} ` +
        `limit=${limit.limit}/${limit.windowMs}ms`
    );
    return false;
  }

  list.push(now);
  buckets.set(key, list);
  return true;
}

/**
 * Drop every bucket for a socket id. Called from the disconnect handler.
 */
export function pruneRateLimitForSocket(socketId: string): void {
  if (!socketId) return;
  const prefix = `${socketId}::`;
  for (const key of buckets.keys()) {
    if (key.startsWith(prefix)) {
      buckets.delete(key);
    }
  }
}

/**
 * Test / diagnostic helper. Returns the number of tracked buckets.
 */
export function rateLimitSize(): number {
  return buckets.size;
}
