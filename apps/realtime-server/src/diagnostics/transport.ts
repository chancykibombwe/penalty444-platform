/**
 * Realtime transport & presence diagnostics.
 *
 * DIAGNOSTICS ONLY. This module never mutates gameplay state, timers,
 * disconnect-grace, scoring, or any room field used by the match
 * pipeline. Every export is a logging helper plus a tiny in-memory
 * bookkeeping map used purely to derive richer log lines (reconnect
 * duration, duplicate / out-of-order presence, room-state mismatch).
 *
 * Log prefixes:
 *   [diag:transport] — socket connect / disconnect / reconnect / transport
 *   [diag:presence]  — player:present / player:absent transitions
 *   [diag:roomstate] — room:update / match:update emits + mismatches
 *   [diag:activeroom]— active-room set / clear
 *
 * Nothing here changes behaviour; it is safe to remove wholesale.
 */

import type { Server, Socket } from "socket.io";
import type { Room } from "../types/room";

/** Reconnect slower than this is flagged for investigation. */
export const SLOW_RECONNECT_THRESHOLD_MS = 2000;

type PresenceRecord = {
  present: boolean;
  /** Monotonic arrival sequence for this room|player presence stream. */
  seq: number;
  /** socketId that produced the last transition. */
  socketId: string | null;
  at: number;
};

/** key = `${roomCode}|${playerId}` → last observed presence transition. */
const presenceByRoomPlayer = new Map<string, PresenceRecord>();

/** playerId → epoch ms of last observed disconnect (for reconnect duration). */
const lastDisconnectAtByPlayer = new Map<string, number>();

/** Global monotonic presence-event counter (arrival order across rooms). */
let presenceSeqCounter = 0;

function presenceKey(roomCode: string, playerId: string): string {
  return `${roomCode}|${playerId}`;
}

function transportName(socket: Socket): string {
  // `socket.conn.transport.name` is "polling" or "websocket".
  return socket.conn?.transport?.name ?? "unknown";
}

/**
 * Log a socket connect and, when we can correlate by playerId, the
 * reconnect duration since that player's last disconnect.
 *
 * `playerId` is optional because the verified Supabase user id is
 * resolved asynchronously; callers that already know the id (e.g.
 * `player:register`, `room:join`) should pass it for correlation.
 */
export function logSocketConnect(
  io: Server,
  socket: Socket,
  playerId?: string | null
): void {
  console.log(
    `[diag:transport] connect socketId=${socket.id} ` +
      `transport=${transportName(socket)} ` +
      `playerId=${playerId ?? socket.data?.userId ?? "-"} ` +
      `clients=${io.engine.clientsCount}`
  );

  // Observe transport upgrades (polling → websocket) for this socket.
  socket.conn?.on("upgrade", () => {
    console.log(
      `[diag:transport] transport_upgrade socketId=${socket.id} ` +
        `transport=${transportName(socket)}`
    );
  });
}

/**
 * Record a disconnect for reconnect-duration correlation and log the
 * reason + transport. Keyed by playerId when known.
 */
export function logSocketDisconnect(
  socket: Socket,
  reason: string,
  playerId?: string | null,
  roomCode?: string | null
): void {
  const id = playerId ?? socket.data?.userId ?? null;
  if (id) {
    lastDisconnectAtByPlayer.set(id, Date.now());
  }
  console.log(
    `[diag:transport] disconnect socketId=${socket.id} ` +
      `reason=${reason} transport=${transportName(socket)} ` +
      `playerId=${id ?? "-"} roomCode=${roomCode ?? "-"}`
  );
}

/**
 * Compute + log reconnect duration for a player who has rejoined a
 * room. Flags slow reconnects (> SLOW_RECONNECT_THRESHOLD_MS).
 * No-op when we never recorded a disconnect for the player.
 */
export function logReconnectForPlayer(
  playerId: string,
  roomCode: string,
  socketId: string
): void {
  const last = lastDisconnectAtByPlayer.get(playerId);
  if (last === undefined) {
    console.log(
      `[diag:transport] reconnect playerId=${playerId} roomCode=${roomCode} ` +
        `socketId=${socketId} reconnectDurationMs=unknown`
    );
    return;
  }

  const durationMs = Date.now() - last;
  lastDisconnectAtByPlayer.delete(playerId);

  console.log(
    `[diag:transport] reconnect playerId=${playerId} roomCode=${roomCode} ` +
      `socketId=${socketId} reconnectDurationMs=${durationMs}`
  );

  if (durationMs > SLOW_RECONNECT_THRESHOLD_MS) {
    console.warn(
      `[diag:transport] SLOW_RECONNECT playerId=${playerId} roomCode=${roomCode} ` +
        `durationMs=${durationMs} thresholdMs=${SLOW_RECONNECT_THRESHOLD_MS}`
    );
  }
}

/**
 * Record + log a presence transition. Detects:
 *   - duplicate transitions (same boolean twice in a row)
 *   - stale / out-of-order events (transition from a socketId that is
 *     not the one that produced the most recent transition, arriving
 *     after a newer event)
 *
 * `nextPresent=true` ≙ player:present, `false` ≙ player:absent/leave.
 */
export function logPresenceTransition(
  roomCode: string,
  playerId: string,
  nextPresent: boolean,
  source: string,
  socketId: string
): void {
  const key = presenceKey(roomCode, playerId);
  const prev = presenceByRoomPlayer.get(key);
  const seq = ++presenceSeqCounter;
  const label = nextPresent ? "present" : "absent";

  console.log(
    `[diag:presence] ${label} roomCode=${roomCode} playerId=${playerId} ` +
      `socketId=${socketId} source=${source} seq=${seq} ` +
      `prev=${prev ? (prev.present ? "present" : "absent") : "none"}`
  );

  if (prev) {
    if (prev.present === nextPresent) {
      console.warn(
        `[diag:presence] DUPLICATE_PRESENCE_TRANSITION roomCode=${roomCode} ` +
          `playerId=${playerId} state=${label} ` +
          `prevSeq=${prev.seq} seq=${seq} sinceMs=${Date.now() - prev.at}`
      );
    }

    // A transition produced by a socketId other than the one that
    // produced the previous transition, while the previous one was very
    // recent, is the classic refresh/multi-tab out-of-order signature.
    if (
      prev.socketId !== null &&
      prev.socketId !== socketId &&
      Date.now() - prev.at < SLOW_RECONNECT_THRESHOLD_MS
    ) {
      console.warn(
        `[diag:presence] OUT_OF_ORDER_PRESENCE roomCode=${roomCode} ` +
          `playerId=${playerId} prevSocketId=${prev.socketId} ` +
          `socketId=${socketId} prevSeq=${prev.seq} seq=${seq} ` +
          `gapMs=${Date.now() - prev.at}`
      );
    }
  }

  presenceByRoomPlayer.set(key, {
    present: nextPresent,
    seq,
    socketId,
    at: Date.now(),
  });
}

/**
 * Log a room:update / match:update emit with a compact state summary
 * and flag internally-inconsistent snapshots. Mismatch detection is
 * read-only — it never repairs state, only logs.
 */
export function logRoomStateEmit(
  event: "room:update" | "match:update",
  roomCode: string,
  room: Room
): void {
  const presentCount = room.players.filter((p) => p.present).length;
  const roleCount = Object.keys(room.roles).length;

  console.log(
    `[diag:roomstate] ${event} roomCode=${roomCode} ` +
      `players=${room.players.length} present=${presentCount} ` +
      `roles=${roleCount} round=${room.round} phase=${room.phase} ` +
      `isResolving=${Boolean(room.isResolving)} ` +
      `matchEnded=${Boolean(room.matchEnded)} ` +
      `picks={K:${Boolean(room.picks.KICKER)},G:${Boolean(room.picks.KEEPER)}} ` +
      `disconnectedPlayerId=${room.disconnectedPlayerId ?? "-"}`
  );

  // Mismatch: two players but role map doesn't cover both.
  if (room.players.length === 2 && roleCount < 2) {
    console.warn(
      `[diag:roomstate] ROOM_STATE_MISMATCH_ROLES roomCode=${roomCode} ` +
        `players=2 roleCount=${roleCount}`
    );
  }

  // Mismatch: resolving while no picks are locked (or only one), which
  // should not normally persist across an emit.
  if (
    room.isResolving &&
    !(room.picks.KICKER && room.picks.KEEPER) &&
    !room.matchEnded
  ) {
    console.warn(
      `[diag:roomstate] ROOM_STATE_MISMATCH_RESOLVING roomCode=${roomCode} ` +
        `isResolving=true picksLocked={K:${Boolean(room.picks.KICKER)},` +
        `G:${Boolean(room.picks.KEEPER)}}`
    );
  }

  // Mismatch: a disconnect-grace target is no longer in the room.
  if (
    room.disconnectedPlayerId &&
    !room.players.some((p) => p.playerId === room.disconnectedPlayerId)
  ) {
    console.warn(
      `[diag:roomstate] ROOM_STATE_MISMATCH_GRACE_TARGET roomCode=${roomCode} ` +
        `disconnectedPlayerId=${room.disconnectedPlayerId} not-in-room`
    );
  }
}

/** Log an active-room set with the diagnostics prefix. */
export function logActiveRoomSet(playerId: string, roomCode: string): void {
  console.log(
    `[diag:activeroom] set playerId=${playerId} roomCode=${roomCode}`
  );
}

/** Log an active-room clear with the diagnostics prefix. */
export function logActiveRoomClear(playerId: string): void {
  console.log(`[diag:activeroom] clear playerId=${playerId}`);
}

/**
 * Drop bookkeeping for a socket / player so the maps don't grow without
 * bound over long uptimes. Diagnostics-only cleanup.
 */
export function pruneTransportDiagnostics(playerId?: string | null): void {
  if (!playerId) return;
  lastDisconnectAtByPlayer.delete(playerId);
}
