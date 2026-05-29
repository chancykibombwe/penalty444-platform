import type { Server } from "socket.io";
import { rooms } from "../state/stores";
import type { Room } from "../types/room";

export const DISCONNECT_FORFEIT_MS = 39_000;

export type StartRoundTimerFn = (roomCode: string, room: Room) => void;
export type EndMatchFn = (roomCode: string, room: Room) => void;

/**
 * Cancel any pending disconnect/forfeit grace for this room.
 * Idempotent — safe to call before re-arming or on reconnect.
 */
export function clearDisconnectForfeitGrace(room: Room): void {
  if (room.disconnectForfeitTimeout) {
    clearTimeout(room.disconnectForfeitTimeout);
    room.disconnectForfeitTimeout = undefined;
  }
  room.disconnectedPlayerId = undefined;
  room.disconnectedAt = undefined;
  room.disconnectForfeitExpiresAt = undefined;
}

/**
 * Arm the 39s disconnect/forfeit grace for `disconnectedPlayerId`.
 *
 * Used by:
 *   - mid-round disconnect before pick (`NO_PICK_GRACE_ARMED`)
 *   - next-round continuation when a player is still absent
 *     (`NEXT_ROUND_GRACE_FOR_ABSENT`)
 *
 * A generation counter guards the forfeit callback so a stale timer
 * cannot fire after reconnect, re-arm, or `clearRoomTimer` races.
 */
export function armDisconnectForfeitGrace(
  io: Server,
  roomCode: string,
  room: Room,
  disconnectedPlayerId: string,
  logTag: string,
  endMatch: EndMatchFn
): void {
  clearDisconnectForfeitGrace(room);

  const generation = (room.disconnectForfeitGeneration ?? 0) + 1;
  room.disconnectForfeitGeneration = generation;

  const forfeitArmedAt = Date.now();
  const forfeitExpiresAt = forfeitArmedAt + DISCONNECT_FORFEIT_MS;

  room.disconnectedPlayerId = disconnectedPlayerId;
  room.disconnectedAt = forfeitArmedAt;
  room.disconnectForfeitExpiresAt = forfeitExpiresAt;

  console.log(
    `[diag:disconnect-policy] ${logTag} ` +
      `roomCode=${roomCode} disconnectedPlayerId=${disconnectedPlayerId} ` +
      `round=${room.round} phase=${room.phase} generation=${generation} ` +
      `expiresAt=${forfeitExpiresAt}`
  );

  io.to(roomCode).emit("match:status", {
    roomCode,
    message: "Opponent disconnected. Waiting 39 seconds for reconnect...",
    phase: room.phase,
    suddenDeathRound: room.suddenDeathRound,
    expiresAt: forfeitExpiresAt,
  });

  room.disconnectForfeitTimeout = setTimeout(() => {
    const r = rooms.get(roomCode);
    if (!r) return;
    if (r.matchEnded) return;

    if (r.disconnectForfeitGeneration !== generation) {
      console.log(
        `[diag:disconnect-policy] FORFEIT_SKIPPED_STALE_GENERATION ` +
          `roomCode=${roomCode} armedGen=${generation} ` +
          `liveGen=${r.disconnectForfeitGeneration ?? 0}`
      );
      return;
    }

    const disconnectedId = r.disconnectedPlayerId;
    if (!disconnectedId || disconnectedId !== disconnectedPlayerId) {
      return;
    }

    const opponent = r.players.find((p) => p.playerId !== disconnectedId);
    if (!opponent) return;

    const maxScore = Math.max(...Object.values(r.scores || {}), 0);
    r.scores[opponent.playerId] = maxScore + 1;

    clearDisconnectForfeitGrace(r);
    endMatch(roomCode, r);
  }, DISCONNECT_FORFEIT_MS);
}

/**
 * Reconnect gate classifier — only restart the pick timer when there
 * is genuinely a pending pick decision for the returning player.
 */
export function shouldRestartPickTimerOnReconnect(
  room: Room,
  playerId: string
): boolean {
  if (room.matchEnded) return false;
  if (room.isResolving) return false;

  const reconnectRole = room.roles[playerId];
  const reconnectOwnPickLocked = reconnectRole
    ? Boolean(room.picks[reconnectRole])
    : false;
  const reconnectBothPicksLocked = Boolean(
    room.picks.KICKER && room.picks.KEEPER
  );

  if (reconnectBothPicksLocked) return false;
  if (reconnectOwnPickLocked) return false;
  return true;
}

/**
 * Clear disconnect grace when the absent/disconnected player returns.
 *
 * Called from `room:join` (existing player) and `player:present` so a
 * reconnect cannot miss grace cleanup when those events arrive in
 * either order.
 *
 * Returns true when grace was cleared for this player.
 */
export function tryResumeAfterDisconnectGrace(
  io: Server,
  roomCode: string,
  room: Room,
  playerId: string,
  startRoundTimer: StartRoundTimerFn
): boolean {
  if (room.disconnectedPlayerId !== playerId) {
    return false;
  }

  clearDisconnectForfeitGrace(room);

  console.log(
    `[diag:disconnect-policy] GRACE_CLEARED_ON_RECONNECT ` +
      `roomCode=${roomCode} playerId=${playerId} round=${room.round}`
  );

  io.to(roomCode).emit("match:status", {
    roomCode,
    message: "Opponent reconnected. Match continues.",
    phase: room.phase,
    suddenDeathRound: room.suddenDeathRound,
  });

  if (shouldRestartPickTimerOnReconnect(room, playerId)) {
    startRoundTimer(roomCode, room);
  } else {
    console.log(
      `[diag:disconnect-policy] reconnect skip startRoundTimer after grace clear ` +
        `roomCode=${roomCode} playerId=${playerId} ` +
        `isResolving=${Boolean(room.isResolving)} ` +
        `matchEnded=${Boolean(room.matchEnded)}`
    );
  }

  return true;
}
