import type { Server, Socket } from "socket.io";
import { cleanUsername, normalizeRoomCode } from "../room/codes";
import {
  jwtEnforcementEnabled,
  jwtMatchesPlayer,
} from "../security/jwt";
import { allowSocketAction } from "../security/rateLimit";
import { rooms } from "../state/stores";
import type { MatchType, Room, RoomPlayer } from "../types/room";

type CreateRoomWithPlayersFn = (
  players: RoomPlayer[],
  maxRounds?: number,
  matchType?: MatchType,
  stakeLabel?: string
) => { code: string; room: Room };

type RoomSocketHandlerDeps = {
  io: Server;
  createRoomWithPlayers: CreateRoomWithPlayersFn;
  getTrackedActiveRoom: (playerId?: string) => string | null;
  playerIsBusyInDifferentRoom: (
    playerId: string,
    targetRoomCode?: string
  ) => string | null;
  setPlayerActiveRoom: (playerId: string, roomCode: string) => void;
  clearPlayerActiveRoom: (playerId?: string) => void;
  isTournamentRoom: (room: Room) => boolean;
  isPlayerAllowedInTournamentRoom: (room: Room, playerId: string) => boolean;
  emitRoomUpdate: (roomCode: string, room: Room) => void;
  emitMatchState: (roomCode: string, room: Room) => void;
  startRoundTimer: (roomCode: string, room: Room) => void;
};

let roomSocketDeps: RoomSocketHandlerDeps | null = null;

export function bindRoomSocketHandlers(deps: RoomSocketHandlerDeps): void {
  roomSocketDeps = deps;
}

function getDeps(): RoomSocketHandlerDeps {
  if (!roomSocketDeps) {
    throw new Error(
      "bindRoomSocketHandlers must be called before room socket handlers."
    );
  }
  return roomSocketDeps;
}

export function registerRoomSocketHandlers(socket: Socket) {
  const deps = getDeps();

  socket.on(
    "activeRoom:clear",
    ({ playerId }: { playerId?: string }) => {
      try {
        if (typeof playerId !== "string" || !playerId.trim()) {
          socket.emit("activeRoom:clear:error", {
            message:
              "Player ID is missing. Unable to clear stale active room.",
          });
          return;
        }

        const normalizedPlayerId = playerId.trim();

        deps.clearPlayerActiveRoom(normalizedPlayerId);

        socket.emit("activeRoom:cleared", {
          message:
            "Your stale active-room entry was cleared locally. Wallet stakes were not modified. You can create or join a match again.",
        });
      } catch (error) {
        console.error("activeRoom:clear crashed:", error);

        socket.emit("activeRoom:clear:error", {
          message:
            error instanceof Error
              ? error.message
              : "Something went wrong while clearing stale active room.",
        });
      }
    }
  );

  socket.on(
    "room:create",
    ({
      playerId,
      username,
    }: {
      playerId: string;
      username?: string;
    }) => {
      if (
        !allowSocketAction(socket.id, "room:create", { playerId })
      ) {
        socket.emit("error:message", {
          message: "Too many room-create attempts. Please wait.",
        });
        return;
      }

      // Sprint 4 TASK 4: soft JWT cross-check on the creator.
      if (!jwtMatchesPlayer(socket, playerId)) {
        if (jwtEnforcementEnabled()) {
          console.warn(
            `[Security] room:create jwt_player_mismatch socketId=${socket.id} ` +
              `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
          socket.emit("error:message", {
            message: "Authentication mismatch. Please sign in again.",
          });
          return;
        }
      }

      const busyRoomCode = deps.getTrackedActiveRoom(playerId);

      if (busyRoomCode) {
        socket.emit("error:message", {
          message: `You are already in an active room (${busyRoomCode}). Finish or leave that match first.`,
        });
        return;
      }

      const playerName = cleanUsername(username);

      const { code } = deps.createRoomWithPlayers(
        [
          {
            playerId,
            socketId: socket.id,
            username: playerName,
          },
        ],
        3,
        "private",
        "Free"
      );

      deps.setPlayerActiveRoom(playerId, code);

      socket.emit("room:created", {
        roomCode: code,
      });

      socket.emit("room:joined", {
        roomCode: code,
      });
    }
  );

  socket.on(
    "room:join",
    ({
      roomCode,
      playerId,
      username,
    }: {
      roomCode: string;
      playerId: string;
      username?: string;
    }) => {
      if (
        !allowSocketAction(socket.id, "room:join", { roomCode, playerId })
      ) {
        return;
      }

      // Sprint 4 TASK 4: soft JWT cross-check on the joining player.
      // Strict in enforce mode; logged-only otherwise.
      if (!jwtMatchesPlayer(socket, playerId)) {
        if (jwtEnforcementEnabled()) {
          console.warn(
            `[Security] room:join jwt_player_mismatch socketId=${socket.id} ` +
              `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
          socket.emit("error:message", {
            message: "Authentication mismatch. Please sign in again.",
          });
          return;
        }
      }

      const code = normalizeRoomCode(roomCode);
      const playerName = cleanUsername(username);

      if (!code) {
        socket.emit("error:message", { message: "Room code is required" });
        return;
      }

      const room = rooms.get(code);

      if (!room) {
        socket.emit("error:message", { message: "Room not found" });
        return;
      }

      if (
        deps.isTournamentRoom(room) &&
        !deps.isPlayerAllowedInTournamentRoom(room, playerId)
      ) {
        socket.emit("error:message", {
          message: "You are not authorized to join this tournament match.",
        });
        return;
      }

      const existingPlayer = room.players.find(
        (player) => player.playerId === playerId
      );

      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.username = playerName;

        deps.setPlayerActiveRoom(playerId, code);

        if (room.disconnectedPlayerId === playerId) {
          if (room.disconnectForfeitTimeout) {
            clearTimeout(room.disconnectForfeitTimeout);
            room.disconnectForfeitTimeout = undefined;
          }

          room.disconnectedPlayerId = undefined;
          room.disconnectedAt = undefined;

          deps.io.to(code).emit("match:status", {
            message: "Opponent reconnected. Match continues.",
            phase: room.phase,
            suddenDeathRound: room.suddenDeathRound,
          });

          // Keep reconnect logic simple: always restart the round timer.
          deps.startRoundTimer(code, room);
        }

        socket.join(code);
        socket.emit("room:joined", { roomCode: code });

        deps.emitRoomUpdate(code, room);
        deps.emitMatchState(code, room);
        return;
      }

      const busyDifferentRoomCode = deps.playerIsBusyInDifferentRoom(
        playerId,
        code
      );

      if (busyDifferentRoomCode) {
        socket.emit("error:message", {
          message: `You are already in another active room (${busyDifferentRoomCode}). Finish or leave that match first.`,
        });
        return;
      }

      if (room.matchEnded) {
        socket.emit("error:message", {
          message: "This match has already ended.",
        });
        return;
      }

      if (room.players.length >= 2) {
        socket.emit("error:message", { message: "Room is full" });
        return;
      }

      room.players.push({
        playerId,
        socketId: socket.id,
        username: playerName,
      });

      room.roles[playerId] = "KEEPER";
      room.scores[playerId] = 0;

      deps.setPlayerActiveRoom(playerId, code);

      socket.join(code);
      socket.emit("room:joined", { roomCode: code });

      deps.emitRoomUpdate(code, room);
      deps.emitMatchState(code, room);

      if (room.players.length === 2) {
        deps.startRoundTimer(code, room);
      }
    }
  );
}
