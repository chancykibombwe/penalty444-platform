import { randomUUID } from "crypto";
import type { Server } from "socket.io";
import { playerActiveRooms, rooms } from "../state/stores";
import type { MatchType, Room, RoomPlayer } from "../types/room";
import { getStakeAmount } from "../wallet/stakes";
import { generateRoomCode, normalizeRoomCode } from "./codes";

/**
 * Hardening Sprint 1 — TASK 3: stable per-match-instance id. Recomputed
 * on rematch (`resetRoomForRematch` bumps it explicitly).
 */
export function generateMatchInstanceId(): string {
  return randomUUID();
}

export function getTrackedActiveRoom(playerId?: string) {
  if (!playerId) return null;

  const trackedRoomCode = playerActiveRooms.get(playerId);
  if (!trackedRoomCode) return null;

  const room = rooms.get(trackedRoomCode);

  if (!room || room.matchEnded) {
    playerActiveRooms.delete(playerId);
    return null;
  }

  return trackedRoomCode;
}

export function setPlayerActiveRoom(playerId: string, roomCode: string) {
  const code = normalizeRoomCode(roomCode);
  if (!playerId || !code) return;

  playerActiveRooms.set(playerId, code);
  console.log(`[active-room:set] player=${playerId} room=${code}`);
}

export function clearPlayerActiveRoom(playerId?: string) {
  if (!playerId) return;

  playerActiveRooms.delete(playerId);
  console.log(`[active-room:clear] player=${playerId}`);
}

export function clearPlayersActiveRoomsForRoom(room: Room) {
  for (const player of room.players) {
    clearPlayerActiveRoom(player.playerId);
  }
}

export function playerIsBusyInDifferentRoom(
  playerId: string,
  targetRoomCode?: string
) {
  const trackedRoomCode = getTrackedActiveRoom(playerId);
  if (!trackedRoomCode) return null;

  const targetCode = normalizeRoomCode(targetRoomCode);

  if (targetCode && trackedRoomCode === targetCode) {
    return null;
  }

  return trackedRoomCode;
}

type RoomLifecycleDeps = {
  io: Server;
  emitRoomUpdate: (roomCode: string, room: Room) => void;
  emitMatchState: (roomCode: string, room: Room) => void;
  startRoundTimer: (roomCode: string, room: Room) => void;
};

let lifecycleDeps: RoomLifecycleDeps | null = null;

export function bindRoomLifecycle(deps: RoomLifecycleDeps): void {
  lifecycleDeps = deps;
}

function getLifecycleDeps(): RoomLifecycleDeps {
  if (!lifecycleDeps) {
    throw new Error("bindRoomLifecycle must be called before room creation.");
  }
  return lifecycleDeps;
}

export function createRoomWithPlayers(
  players: RoomPlayer[],
  maxRounds = 3,
  matchType: MatchType = "private",
  stakeLabel = "Free"
) {
  const { io, emitRoomUpdate, emitMatchState, startRoundTimer } =
    getLifecycleDeps();

  const code = generateRoomCode();
  const firstPlayer = players[0];
  const secondPlayer = players[1];
  const stakeAmount = getStakeAmount(stakeLabel);
  const now = Date.now();

  const room: Room = {
    code,
    matchInstance: 1,
    matchInstanceId: generateMatchInstanceId(),
    players,
    roles: {},
    picks: {},
    scores: {},
    round: 1,
    maxRounds,
    phase: "NORMAL",
    suddenDeathRound: 0,
    rematchVotes: [],
    matchEnded: false,
    matchType,
    stakeLabel,
    stakeAmount,
    stakeSettled: false,
    settlementStarted: false,
    resultSaved: false,
    progressionApplied: false,
    isResolving: false,
    createdAt: now,
    lastActivityAt: now,
    spectatorSocketIds: new Set<string>(),
  };

  if (firstPlayer) {
    room.roles[firstPlayer.playerId] = "KICKER";
    room.scores[firstPlayer.playerId] = 0;
  }

  if (secondPlayer) {
    room.roles[secondPlayer.playerId] = "KEEPER";
    room.scores[secondPlayer.playerId] = 0;
  }

  rooms.set(code, room);

  for (const player of players) {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    playerSocket?.join(code);
    setPlayerActiveRoom(player.playerId, code);
  }

  emitRoomUpdate(code, room);
  emitMatchState(code, room);

  if (room.players.length === 2) {
    startRoundTimer(code, room);
  }

  return { code, room };
}

export type CreateTournamentRoomParams = {
  players: RoomPlayer[];
  maxRounds?: number;
  tournamentMatchId: string;
  tournamentId: string;
  allowedPlayerIds: string[];
};

/**
 * Creates an in-memory tournament bracket room (no stakes, no rematch / early cancel).
 * Intended for Phase B API / internal bridge; not exposed to clients directly in v1.
 */
export function createTournamentRoom({
  players,
  maxRounds = 3,
  tournamentMatchId,
  tournamentId,
  allowedPlayerIds,
}: CreateTournamentRoomParams) {
  const { io, emitRoomUpdate, emitMatchState, startRoundTimer } =
    getLifecycleDeps();

  const normalizedAllowed = allowedPlayerIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (normalizedAllowed.length !== 2) {
    throw new Error(
      "Tournament rooms require exactly two allowed player IDs."
    );
  }

  const uniqueAllowed = new Set(normalizedAllowed);
  if (uniqueAllowed.size !== 2) {
    throw new Error("Tournament allowed player IDs must be distinct.");
  }

  for (const player of players) {
    if (!uniqueAllowed.has(player.playerId.trim())) {
      throw new Error(
        "Initial tournament room players must be in allowedPlayerIds."
      );
    }
  }

  if (players.length > 2) {
    throw new Error("Tournament rooms cannot start with more than two players.");
  }

  const code = generateRoomCode();
  const firstPlayer = players[0];
  const secondPlayer = players[1];
  const now = Date.now();

  const room: Room = {
    code,
    matchInstance: 1,
    matchInstanceId: generateMatchInstanceId(),
    players: [...players],
    roles: {},
    picks: {},
    scores: {},
    round: 1,
    maxRounds,
    phase: "NORMAL",
    suddenDeathRound: 0,
    rematchVotes: [],
    matchEnded: false,
    matchType: "tournament",
    tournamentMatchId,
    tournamentId,
    allowedPlayerIds: normalizedAllowed,
    stakeLabel: "Free",
    stakeAmount: 0,
    stakeSettled: false,
    settlementStarted: false,
    resultSaved: false,
    progressionApplied: false,
    isResolving: false,
    createdAt: now,
    lastActivityAt: now,
    spectatorSocketIds: new Set<string>(),
  };

  if (firstPlayer) {
    room.roles[firstPlayer.playerId] = "KICKER";
    room.scores[firstPlayer.playerId] = 0;
  }

  if (secondPlayer) {
    room.roles[secondPlayer.playerId] = "KEEPER";
    room.scores[secondPlayer.playerId] = 0;
  }

  rooms.set(code, room);

  for (const player of players) {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    playerSocket?.join(code);
    setPlayerActiveRoom(player.playerId, code);
  }

  emitRoomUpdate(code, room);
  emitMatchState(code, room);

  if (room.players.length === 2) {
    startRoundTimer(code, room);
  }

  return { code, room };
}
