/**
 * Hardening Sprint 1 — TASK 2: socket identity enforcement.
 *
 * Single source of truth for "does this socket actually represent this
 * player in this room?". Used by every sensitive event handler
 * (match:pick, match:forfeit, match:abortEarly, match:rematch*).
 *
 * The guard is intentionally simple because we do not yet have full JWT
 * auth in the realtime server:
 *   - The player must be a member of the room (room.players).
 *   - The player's stored socketId must match the live socket.id.
 *   - Spectator sockets (room.spectatorSocketIds) are always rejected.
 *   - Tournament rooms additionally require allowedPlayerIds membership.
 *
 * If any check fails we log `[Security] rejected spoofed action` and
 * return a result the caller uses to silently bail without mutating room
 * state.
 */

import type { Socket } from "socket.io";
import type { Room, RoomPlayer } from "../types/room";
import { jwtMatchesPlayer } from "./jwt";

export type IdentityCheckResult =
  | { ok: true; player: RoomPlayer }
  | { ok: false; reason: IdentityRejectReason };

export type IdentityRejectReason =
  | "missing_player_id"
  | "spectator_socket"
  | "player_not_in_room"
  | "socket_player_mismatch"
  | "tournament_not_allowed"
  | "jwt_player_mismatch";

/**
 * Validate that `socket.id` is bound to `playerId` inside `room`.
 *
 * Does NOT mutate room state. Caller is responsible for the bail.
 */
export function resolvePlayerForSocket(
  room: Room,
  socket: Socket,
  rawPlayerId: unknown,
  action: string
): IdentityCheckResult {
  const playerId =
    typeof rawPlayerId === "string" ? rawPlayerId.trim() : "";

  if (!playerId) {
    logRejection(action, socket.id, "missing_player_id", room.code);
    return { ok: false, reason: "missing_player_id" };
  }

  if (room.spectatorSocketIds.has(socket.id)) {
    logRejection(action, socket.id, "spectator_socket", room.code, playerId);
    return { ok: false, reason: "spectator_socket" };
  }

  const player = room.players.find((p) => p.playerId === playerId);
  if (!player) {
    logRejection(action, socket.id, "player_not_in_room", room.code, playerId);
    return { ok: false, reason: "player_not_in_room" };
  }

  if (player.socketId !== socket.id) {
    logRejection(
      action,
      socket.id,
      "socket_player_mismatch",
      room.code,
      playerId,
      player.socketId
    );
    return { ok: false, reason: "socket_player_mismatch" };
  }

  if (
    room.matchType === "tournament" &&
    Array.isArray(room.allowedPlayerIds) &&
    room.allowedPlayerIds.length > 0 &&
    !room.allowedPlayerIds.includes(playerId)
  ) {
    logRejection(
      action,
      socket.id,
      "tournament_not_allowed",
      room.code,
      playerId
    );
    return { ok: false, reason: "tournament_not_allowed" };
  }

  // If the socket has a verified JWT it must match the claimed playerId.
  // A token proving a different identity is never overridden by a
  // client-supplied claim, regardless of SOCKET_JWT_ENFORCE mode.
  if (!jwtMatchesPlayer(socket, playerId)) {
    logRejection(
      action,
      socket.id,
      "jwt_player_mismatch",
      room.code,
      playerId,
      socket.data.userId ?? undefined
    );
    return { ok: false, reason: "jwt_player_mismatch" };
  }

  return { ok: true, player };
}

/**
 * Convenience boolean form. Use `resolvePlayerForSocket` when you also need
 * the `RoomPlayer` instance.
 */
export function assertSocketOwnsPlayer(
  room: Room,
  socket: Socket,
  rawPlayerId: unknown,
  action: string
): boolean {
  return resolvePlayerForSocket(room, socket, rawPlayerId, action).ok;
}

function logRejection(
  action: string,
  socketId: string,
  reason: IdentityRejectReason,
  roomCode: string,
  playerId?: string,
  expectedSocketId?: string
): void {
  console.warn(
    `[Security] rejected spoofed action action=${action} socketId=${socketId} reason=${reason} roomCode=${roomCode} playerId=${playerId ?? "—"}${
      expectedSocketId ? ` expectedSocketId=${expectedSocketId}` : ""
    }`
  );
}
