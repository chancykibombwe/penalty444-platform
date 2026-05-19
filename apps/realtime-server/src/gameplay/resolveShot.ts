import type { Lane, Role, Room, ShotResult } from "../types/room";

/**
 * Authoritative shot outcome for match:result.
 * Rule: same lane => SAVE; different lanes => GOAL.
 */
export function resolveShot(kickerLane?: Lane, keeperLane?: Lane): ShotResult {
  if (!kickerLane && !keeperLane) return "DRAW";
  if (!kickerLane && keeperLane) return "SAVE";
  if (kickerLane && !keeperLane) return "GOAL";
  if (kickerLane === keeperLane) return "SAVE";
  return "GOAL";
}

export function getPointWinnerRole(
  kickerLane?: Lane,
  keeperLane?: Lane,
  result?: ShotResult
): Role | null {
  if (!kickerLane && !keeperLane) return null;
  if (!kickerLane && keeperLane) return null;
  if (kickerLane && !keeperLane) return "KICKER";
  if (result === "GOAL") return "KICKER";

  return null;
}

export function getPlayerByRole(room: Room, role: Role) {
  return Object.keys(room.roles).find(
    (playerId) => room.roles[playerId] === role
  );
}

export function swapRoles(room: Room) {
  const currentRoles = { ...room.roles };

  for (const playerId of Object.keys(currentRoles)) {
    room.roles[playerId] =
      currentRoles[playerId] === "KICKER" ? "KEEPER" : "KICKER";
  }
}

/**
 * Repairs invalid role maps (e.g. tournament rooms where both joiners were assigned KEEPER).
 * Uses join order in room.players and current round parity after swapRoles alternation.
 */
export function ensureAuthoritativeRoomRoles(room: Room): boolean {
  if (room.players.length !== 2) {
    return false;
  }

  const firstId = room.players[0]?.playerId;
  const secondId = room.players[1]?.playerId;

  if (!firstId || !secondId) {
    return false;
  }

  const firstRole = room.roles[firstId];
  const secondRole = room.roles[secondId];
  const kickerId = getPlayerByRole(room, "KICKER");
  const keeperId = getPlayerByRole(room, "KEEPER");

  const needsRepair =
    !firstRole ||
    !secondRole ||
    firstRole === secondRole ||
    !kickerId ||
    !keeperId ||
    kickerId === keeperId;

  if (!needsRepair) {
    return false;
  }

  const swapsFromStart = Math.max(0, room.round - 1);
  const firstPlayerIsKicker = swapsFromStart % 2 === 0;

  room.roles[firstId] = firstPlayerIsKicker ? "KICKER" : "KEEPER";
  room.roles[secondId] = firstPlayerIsKicker ? "KEEPER" : "KICKER";

  console.warn(
    `[roles] repaired room=${room.code} round=${room.round} roles=${JSON.stringify(room.roles)}`
  );

  return true;
}
