/**
 * Hardening Sprint 1 — TASK 1: spectator/player room separation.
 *
 * Spectators join a SEPARATE Socket.IO channel (`${roomCode}:spectators`)
 * and are NEVER added to `room.players`. They cannot influence:
 *   - room.players or roles
 *   - timers / pick state / reconnect timeline
 *   - tournament presence / advancement
 *
 * Only the events emitted explicitly via `emitToSpectators` ever reach
 * them. Pre-reveal picks are NEVER forwarded — the DB-polling design of
 * the watch route inherently masks them, and this socket path mirrors
 * that contract on the live wire.
 *
 * Spectator membership is tracked on the room (`spectatorSocketIds`) so
 * cleanup, sweeping, and identity checks can reason about it.
 */

import type { Server, Socket } from "socket.io";
import { normalizeRoomCode } from "../room/codes";
import { rooms } from "../state/stores";
import type { Room } from "../types/room";

export function spectatorChannel(roomCode: string): string {
  return `${roomCode}:spectators`;
}

let serverRef: Server | null = null;

export function bindSpectatorServer(io: Server): void {
  serverRef = io;
}

function getServer(): Server {
  if (!serverRef) {
    throw new Error(
      "bindSpectatorServer must be called before spectator emits."
    );
  }
  return serverRef;
}

/**
 * Emit a payload only to spectators of `roomCode`. Players are never
 * affected because the spectator channel is a disjoint Socket.IO room.
 */
export function emitToSpectators(
  roomCode: string,
  event: string,
  payload: unknown
): void {
  getServer().to(spectatorChannel(roomCode)).emit(event, payload);

  console.log(
    `[Spectator] safe update emitted roomCode=${roomCode} event=${event}`
  );
}

/**
 * Register the `spectator:join` / `spectator:leave` handlers for a newly
 * connected socket. These are the ONLY entry points for spectator state
 * — they never call player join logic, never mutate `room.players`, never
 * touch timers.
 */
export function registerSpectatorHandlers(socket: Socket): void {
  socket.on(
    "spectator:join",
    ({ roomCode }: { roomCode?: string }) => {
      const code = normalizeRoomCode(roomCode ?? "");
      if (!code) {
        socket.emit("spectator:rejected", {
          reason: "missing_room_code",
        });
        console.warn(
          `[Spectator] rejected reason=missing_room_code socketId=${socket.id}`
        );
        return;
      }

      const room = rooms.get(code);
      if (!room) {
        socket.emit("spectator:rejected", {
          reason: "room_not_found",
          roomCode: code,
        });
        console.warn(
          `[Spectator] rejected reason=room_not_found socketId=${socket.id} roomCode=${code}`
        );
        return;
      }

      // Defensive: spectators MUST NOT appear in `room.players`. If a
      // socket is already a player on this room, refuse to convert it
      // into a spectator on the same socket (avoids ambiguity).
      const isPlayerSocket = room.players.some(
        (p) => p.socketId === socket.id
      );
      if (isPlayerSocket) {
        socket.emit("spectator:rejected", {
          reason: "socket_is_player",
          roomCode: code,
        });
        console.warn(
          `[Spectator] rejected reason=socket_is_player socketId=${socket.id} roomCode=${code}`
        );
        return;
      }

      room.spectatorSocketIds.add(socket.id);
      socket.join(spectatorChannel(code));

      socket.emit("spectator:joined", {
        roomCode: code,
        matchEnded: room.matchEnded,
        matchInstance: room.matchInstance,
      });

      console.log(
        `[Spectator] joined socketId=${socket.id} roomCode=${code} totalSpectators=${room.spectatorSocketIds.size}`
      );
    }
  );

  socket.on(
    "spectator:leave",
    ({ roomCode }: { roomCode?: string }) => {
      const code = normalizeRoomCode(roomCode ?? "");
      if (!code) return;

      const room = rooms.get(code);
      if (!room) return;

      room.spectatorSocketIds.delete(socket.id);
      socket.leave(spectatorChannel(code));
    }
  );
}

/**
 * Remove `socketId` from every room's spectator set. Called from the
 * generic disconnect handler so spectator references don't pile up.
 */
export function pruneSpectatorOnDisconnect(socketId: string): void {
  for (const room of rooms.values()) {
    if (room.spectatorSocketIds.delete(socketId)) {
      console.log(
        `[Spectator] disconnect pruned socketId=${socketId} roomCode=${room.code}`
      );
    }
  }
}

/**
 * Public helper used by emit sites that need to decide whether a payload
 * is safe for spectators. We never push pre-reveal pick state to the
 * spectator channel — this is just a guard for future code reviews.
 */
export function isSpectatorSafeEvent(event: string): boolean {
  switch (event) {
    case "match:update":
    case "match:status":
    case "match:result":
    case "match:end":
    case "match:aborted":
    case "room:update":
      return true;
    default:
      return false;
  }
}

/**
 * Mirror a player-room emit onto the spectator channel for events that
 * are safe to share (scoreboard / round / status / official result).
 *
 * Spectator emits intentionally never carry private state because
 * the source payloads themselves do not — picks are derived from
 * `room.picks` on the server and never sent to clients pre-reveal.
 */
export function mirrorToSpectators(
  room: Room,
  event: string,
  payload: unknown
): void {
  if (!isSpectatorSafeEvent(event)) {
    return;
  }
  if (room.spectatorSocketIds.size === 0) {
    return;
  }
  emitToSpectators(room.code, event, payload);
}
