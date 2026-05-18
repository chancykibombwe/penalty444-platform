import type { Lane, Role, Room, ShotResult } from "../types/room";

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
