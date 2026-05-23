/**
 * Hardening Sprint 4 — TASK 6: lightweight replay / stale-event guard.
 *
 * Many sensitive socket events are already idempotent at the state-machine
 * layer (a duplicate `match:pick` is bounced because `room.picks[role]`
 * is already set, a duplicate `match:rematch` is bounced because the
 * vote is already in `room.rematchVotes`, etc.). This guard adds a
 * lightweight LAYER-2 protection for events where the client supplies
 * a `clientEventId` (or some other deduplication token), so the same
 * client can't accidentally emit the same action twice in flight.
 *
 * Design constraints:
 *
 *   - Memory bounded: we keep the last `MAX_EVENTS_PER_BUCKET` ids per
 *     `(roomCode, socketId)` pair. Older ids age out as new ones arrive.
 *   - No external dependency. Pure in-process Map; reset on restart is
 *     fine (idempotency at the DB layer is the durable backstop).
 *   - Cleanup: the room cleanup sweeper calls `cleanupEventHistory` when
 *     a room is deleted; the disconnect handler calls
 *     `pruneSocketEventHistory` when a socket goes away.
 *   - Optional: handlers that don't get a `clientEventId` are unchanged.
 *
 * Usage:
 *
 *   if (clientEventId && hasSeenEvent(roomCode, socket.id, clientEventId)) {
 *     console.warn("[Security] replay rejected ...");
 *     return;
 *   }
 *   markEventSeen(roomCode, socket.id, clientEventId);
 *   // ... mutate state ...
 */

const MAX_EVENTS_PER_BUCKET = 32;

/**
 * Map keyed by `${roomCode}::${socketId}` → ordered list of event ids.
 * The list is treated as a small ring buffer — when it reaches
 * `MAX_EVENTS_PER_BUCKET` the oldest id is dropped on the next insert.
 */
const seenEvents = new Map<string, string[]>();

function bucketKey(roomCode: string, socketId: string): string {
  return `${roomCode}::${socketId}`;
}

export function hasSeenEvent(
  roomCode: string,
  socketId: string,
  eventId: string
): boolean {
  if (!roomCode || !socketId || !eventId) return false;
  const list = seenEvents.get(bucketKey(roomCode, socketId));
  if (!list) return false;
  return list.includes(eventId);
}

export function markEventSeen(
  roomCode: string,
  socketId: string,
  eventId: string
): void {
  if (!roomCode || !socketId || !eventId) return;
  const key = bucketKey(roomCode, socketId);
  const list = seenEvents.get(key) ?? [];
  if (list.includes(eventId)) return;
  list.push(eventId);
  if (list.length > MAX_EVENTS_PER_BUCKET) {
    list.splice(0, list.length - MAX_EVENTS_PER_BUCKET);
  }
  seenEvents.set(key, list);
}

/**
 * Drop every recorded eventId for a room. Called from the cleanup
 * pipeline (`scheduleRoomCleanup` etc.) so a stale room can't keep its
 * event history alive forever.
 */
export function cleanupEventHistory(roomCode: string): void {
  if (!roomCode) return;
  const prefix = `${roomCode}::`;
  for (const key of seenEvents.keys()) {
    if (key.startsWith(prefix)) {
      seenEvents.delete(key);
    }
  }
}

/**
 * Drop every recorded eventId for a socket id (any room). Called from
 * the realtime server's `disconnect` handler.
 */
export function pruneSocketEventHistory(socketId: string): void {
  if (!socketId) return;
  const suffix = `::${socketId}`;
  for (const key of seenEvents.keys()) {
    if (key.endsWith(suffix)) {
      seenEvents.delete(key);
    }
  }
}

/**
 * Test / diagnostic helper. Returns the in-memory size — useful from
 * `/health` style endpoints.
 */
export function replayGuardSize(): number {
  let total = 0;
  for (const list of seenEvents.values()) total += list.length;
  return total;
}
