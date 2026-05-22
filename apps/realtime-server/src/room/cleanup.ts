/**
 * Hardening Sprint 1 — TASK 4 + TASK 8: room cleanup + stale TTL sweep.
 *
 * Two helpers:
 *
 *   - `scheduleRoomCleanup(roomCode, reason, opts)`
 *       Delayed deletion of a finished room. Captures `matchInstanceId`
 *       so a rematch reusing the same code is NOT deleted by a stale
 *       cleanup timer. Cancellable.
 *
 *   - `startStaleRoomSweeper(io)`
 *       Periodic sweep (every 60s) that cleans rooms with zero player
 *       sockets, no recent activity, or unfinished matches that have
 *       gone idle past a safe TTL. Tournament rooms get more lenient
 *       windows so a player still has time to reconnect.
 *
 * Both helpers route through `removeRoomNow` which is the single point
 * that actually deletes from in-memory stores. This guarantees that no
 * codepath leaks `rooms`, `tournamentMatchRooms`, `resolveRoundSeqByRoom`,
 * spectator memberships, or `playerActiveRooms` references.
 */

import type { Server } from "socket.io";
import {
  playerActiveRooms,
  rooms,
  tournamentMatchRooms,
} from "../state/stores";
import { clearRoomTimer } from "../gameplay/timers";
import { spectatorChannel } from "../socket/spectator";
import type { Room } from "../types/room";

/** Map of resolveSeq counters — exported lazily by `index.ts`. */
type ResolveSeqMap = Map<string, number>;

let resolveSeqMapRef: ResolveSeqMap | null = null;

export function bindResolveSeqMap(map: ResolveSeqMap): void {
  resolveSeqMapRef = map;
}

const ENDED_ROOM_TTL_MS = 60_000;
const STALE_ROOM_IDLE_MS = 5 * 60_000;
const TOURNAMENT_IDLE_GRACE_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Cancel any pending cleanup on this room. Useful when a rematch revives
 * a room — the prior cleanup must not delete the now-active instance.
 */
export function cancelScheduledCleanup(room: Room): void {
  if (room.cleanupTimeout) {
    clearTimeout(room.cleanupTimeout);
    room.cleanupTimeout = undefined;
  }
}

/**
 * Schedule a delayed cleanup for an ended/aborted room.
 *
 * Defaults to a 60-second delay so clients have time to receive the final
 * `match:end` / `match:aborted` emit and any redirects/scoreboard polls
 * succeed before we delete the room from memory.
 *
 * Critical guard: at fire time we recompute "is this still the same
 * match instance we scheduled cleanup for?". If a rematch has bumped
 * `matchInstanceId`, we skip cleanup.
 */
export function scheduleRoomCleanup(
  io: Server,
  roomCode: string,
  reason: string,
  delayMs: number = ENDED_ROOM_TTL_MS
): void {
  const room = rooms.get(roomCode);
  if (!room) return;

  // Replace any in-flight cleanup with the latest schedule.
  cancelScheduledCleanup(room);

  const scheduledForInstanceId = room.matchInstanceId;

  console.log(
    `[Cleanup] scheduled roomCode=${roomCode} reason=${reason} delayMs=${delayMs} instanceId=${scheduledForInstanceId}`
  );

  room.cleanupTimeout = setTimeout(() => {
    const current = rooms.get(roomCode);
    if (!current) {
      return;
    }

    if (current.matchInstanceId !== scheduledForInstanceId) {
      console.log(
        `[Cleanup] skipped active room (instance rotated) roomCode=${roomCode} scheduled=${scheduledForInstanceId} current=${current.matchInstanceId}`
      );
      current.cleanupTimeout = undefined;
      return;
    }

    if (!current.matchEnded) {
      console.log(
        `[Cleanup] skipped active room (match not ended) roomCode=${roomCode}`
      );
      current.cleanupTimeout = undefined;
      return;
    }

    removeRoomNow(io, current, `cleanup:${reason}`);
  }, delayMs);
}

/**
 * Delete a room from EVERY store + drop its socket rooms. Use this when
 * you definitely want the room gone right now (sweep, abort cancellations
 * older than TTL, etc.). For "match ended cleanly" prefer
 * `scheduleRoomCleanup` so clients have a grace window.
 */
export function removeRoomNow(io: Server, room: Room, reason: string): void {
  const roomCode = room.code;

  clearRoomTimer(room);
  cancelScheduledCleanup(room);

  for (const player of room.players) {
    if (
      player.playerId &&
      playerActiveRooms.get(player.playerId) === roomCode
    ) {
      playerActiveRooms.delete(player.playerId);
    }
  }

  // Drop spectator channel memberships before deleting the room.
  if (room.spectatorSocketIds.size > 0) {
    const channel = spectatorChannel(roomCode);
    for (const sid of room.spectatorSocketIds) {
      const s = io.sockets.sockets.get(sid);
      s?.leave(channel);
    }
    room.spectatorSocketIds.clear();
  }

  if (room.tournamentMatchId) {
    const tracked = tournamentMatchRooms.get(room.tournamentMatchId);
    if (tracked === roomCode) {
      tournamentMatchRooms.delete(room.tournamentMatchId);
    }
  }

  resolveSeqMapRef?.delete(roomCode);
  rooms.delete(roomCode);

  console.log(
    `[Cleanup] completed roomCode=${roomCode} reason=${reason} remainingRooms=${rooms.size}`
  );
}

/**
 * Touch the room's activity clock — call from joins, picks, results,
 * status emits. The stale sweeper relies on this to know whether the
 * room is dormant.
 */
export function touchRoomActivity(room: Room): void {
  room.lastActivityAt = Date.now();
}

/**
 * Periodic sweep that removes ghost / stale rooms. Tournament rooms get
 * a more lenient window so a disconnected player has time to come back.
 *
 * Rooms with an ended match are left to `scheduleRoomCleanup` (it's
 * already running with a 60s timer); the sweep only kills rooms where
 * the dedicated cleanup didn't fire for some reason.
 */
export function startStaleRoomSweeper(io: Server): NodeJS.Timeout {
  const handle = setInterval(() => sweepStaleRooms(io), SWEEP_INTERVAL_MS);
  if (typeof handle.unref === "function") {
    handle.unref();
  }
  return handle;
}

function sweepStaleRooms(io: Server): void {
  const now = Date.now();

  for (const room of Array.from(rooms.values())) {
    // Already scheduled — let that timer do the work.
    if (room.cleanupTimeout) continue;

    const idleFor = now - room.lastActivityAt;

    if (room.matchEnded) {
      if (idleFor > ENDED_ROOM_TTL_MS) {
        removeRoomNow(io, room, "sweep:ended-room-no-cleanup");
      } else {
        scheduleRoomCleanup(io, room.code, "sweep:fallback-schedule");
      }
      continue;
    }

    // Empty room (no players, no spectators) past the TTL → kill it.
    const hasPlayers = room.players.length > 0;
    const hasSpectators = room.spectatorSocketIds.size > 0;

    if (!hasPlayers && !hasSpectators && idleFor > ENDED_ROOM_TTL_MS) {
      removeRoomNow(io, room, "sweep:empty-stale");
      continue;
    }

    // Live but idle for a long time. Tournament rooms are given a
    // larger grace window because a player may disconnect and reconnect.
    const idleThreshold =
      room.matchType === "tournament"
        ? TOURNAMENT_IDLE_GRACE_MS
        : STALE_ROOM_IDLE_MS;

    if (idleFor > idleThreshold) {
      // Don't yank an active tournament with both players still socketed;
      // be conservative — log retention reason.
      const playersStillConnected = room.players.some((p) =>
        io.sockets.sockets.get(p.socketId)
      );
      if (playersStillConnected) {
        console.log(
          `[Cleanup] stale room retained reason=players_connected roomCode=${room.code} idleMs=${idleFor}`
        );
        continue;
      }

      removeRoomNow(io, room, "sweep:idle-stale");
      continue;
    }
  }
}
