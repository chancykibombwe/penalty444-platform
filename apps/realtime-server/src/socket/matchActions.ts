import type { Server, Socket } from "socket.io";
import { EARLY_CANCEL_MS } from "../config";
import { clearRoomTimer } from "../gameplay/timers";
import { normalizeRoomCode } from "../room/codes";
import { rooms } from "../state/stores";
import type { Lane, Room } from "../types/room";

type ResolveRoundFn = (
  roomCode: string,
  room: Room,
  fromTimeout?: boolean
) => void;

type EndMatchFn = (roomCode: string, room: Room) => void;

type AbortMatchEarlyFn = (
  roomCode: string,
  room: Room,
  abortedByPlayerId: string
) => Promise<void>;

type IsTournamentRoomFn = (room: Room) => boolean;

type MatchActionHandlerDeps = {
  io: Server;
  resolveRound: ResolveRoundFn;
  endMatch: EndMatchFn;
  abortMatchEarly: AbortMatchEarlyFn;
  isTournamentRoom: IsTournamentRoomFn;
};

let matchActionDeps: MatchActionHandlerDeps | null = null;

export function bindMatchActionHandlers(deps: MatchActionHandlerDeps): void {
  matchActionDeps = deps;
}

function getDeps(): MatchActionHandlerDeps {
  if (!matchActionDeps) {
    throw new Error(
      "bindMatchActionHandlers must be called before match action handlers."
    );
  }
  return matchActionDeps;
}

export function registerMatchActionHandlers(socket: Socket) {
  const deps = getDeps();

  socket.on(
    "match:pick",
    ({
      roomCode,
      lane,
      playerId,
    }: {
      roomCode: string;
      lane: Lane;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (room.matchEnded) return;
      if (room.isResolving) return;
      if (room.disconnectedPlayerId === playerId) return;

      const role = room.roles[playerId];

      if (!role) return;
      if (room.picks[role]) return;

      room.picks[role] = lane;

      deps.io.to(code).emit("match:status", {
        message: `${
          room.players.find((player) => player.playerId === playerId)
            ?.username || "Player"
        } locked pick.`,
        phase: room.phase,
        suddenDeathRound: room.suddenDeathRound,
      });

      if (room.picks.KICKER && room.picks.KEEPER) {
        clearRoomTimer(room);
        deps.resolveRound(code, room);
      }
    }
  );

  socket.on(
    "match:abortEarly",
    async ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) {
        socket.emit("error:message", { message: "Room not found." });
        return;
      }

      if (deps.isTournamentRoom(room)) {
        socket.emit("error:message", {
          message: "Tournament matches cannot be cancelled.",
        });
        return;
      }

      if (room.players.length !== 2) {
        socket.emit("error:message", {
          message: "Match is not ready to cancel.",
        });
        return;
      }

      if (room.matchEnded) {
        socket.emit("error:message", {
          message: "Match has already ended.",
        });
        return;
      }

      if (room.matchStartedAt === undefined) {
        socket.emit("error:message", {
          message: "Match has not started yet.",
        });
        return;
      }

      if (Date.now() - room.matchStartedAt >= EARLY_CANCEL_MS) {
        socket.emit("error:message", {
          message:
            "Early cancel window has expired. Use forfeit if you want to leave.",
        });
        return;
      }

      if (room.isResolving) {
        socket.emit("error:message", {
          message: "Cannot cancel while a round is resolving.",
        });
        return;
      }

      if (room.picks.KICKER || room.picks.KEEPER) {
        socket.emit("error:message", {
          message: "Cannot cancel after a pick has been submitted.",
        });
        return;
      }

      const playerInRoom = room.players.some(
        (player) => player.playerId === playerId
      );

      if (!playerInRoom) {
        socket.emit("error:message", {
          message: "You are not in this match.",
        });
        return;
      }

      try {
        await deps.abortMatchEarly(code, room, playerId);
      } catch (error) {
        console.error("match:abortEarly failed:", error);
        socket.emit("error:message", {
          message: "Failed to cancel match.",
        });
      }
    }
  );

  socket.on(
    "match:forfeit",
    ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) {
        socket.emit("error:message", { message: "Room not found." });
        return;
      }

      if (room.players.length !== 2) {
        socket.emit("error:message", {
          message: "Match is not ready for forfeit.",
        });
        return;
      }

      if (room.matchEnded) {
        socket.emit("error:message", {
          message: "Match has already ended.",
        });
        return;
      }

      if (room.matchStartedAt === undefined) {
        socket.emit("error:message", {
          message: "Match has not started yet.",
        });
        return;
      }

      if (
        !deps.isTournamentRoom(room) &&
        Date.now() - room.matchStartedAt < EARLY_CANCEL_MS
      ) {
        socket.emit("error:message", {
          message:
            "Use cancel match during the first 5 seconds instead of forfeit.",
        });
        return;
      }

      if (room.isResolving) {
        socket.emit("error:message", {
          message: "Cannot forfeit while a round is resolving.",
        });
        return;
      }

      const playerInRoom = room.players.some(
        (player) => player.playerId === playerId
      );

      if (!playerInRoom) {
        socket.emit("error:message", {
          message: "You are not in this match.",
        });
        return;
      }

      const opponent = room.players.find(
        (player) => player.playerId !== playerId
      );

      if (!opponent) {
        socket.emit("error:message", {
          message: "Opponent not found.",
        });
        return;
      }

      if (room.disconnectForfeitTimeout) {
        clearTimeout(room.disconnectForfeitTimeout);
        room.disconnectForfeitTimeout = undefined;
      }

      room.disconnectedPlayerId = undefined;
      room.disconnectedAt = undefined;

      const maxScore = Math.max(...Object.values(room.scores || {}), 0);
      room.scores[opponent.playerId] = maxScore + 1;

      deps.endMatch(code, room);
    }
  );
}
