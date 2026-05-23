import type { Server, Socket } from "socket.io";
import { clearRoomTimer } from "../gameplay/timers";
import { normalizeRoomCode } from "../room/codes";
import { generateMatchInstanceId, setPlayerActiveRoom } from "../room/lifecycle";
import { cancelScheduledCleanup } from "../room/cleanup";
import { resolvePlayerForSocket } from "../security/identity";
import { allowSocketAction } from "../security/rateLimit";
import { rooms } from "../state/stores";
import type { Room } from "../types/room";

type RematchHandlerDeps = {
  io: Server;
  startRoundTimer: (roomCode: string, room: Room) => void;
  emitMatchState: (roomCode: string, room: Room) => void;
  emitRoomUpdate: (roomCode: string, room: Room) => void;
  isTournamentRoom: (room: Room) => boolean;
};

let rematchDeps: RematchHandlerDeps | null = null;

export function bindRematchHandlers(deps: RematchHandlerDeps): void {
  rematchDeps = deps;
}

function getDeps(): RematchHandlerDeps {
  if (!rematchDeps) {
    throw new Error(
      "bindRematchHandlers must be called before rematch handlers."
    );
  }
  return rematchDeps;
}

function resetRoomForRematch(roomCode: string, room: Room) {
  const deps = getDeps();

  if (deps.isTournamentRoom(room)) {
    return;
  }

  clearRoomTimer(room);
  // A rematch revives a previously-ended room. Cancel any pending
  // cleanup so we don't lose the new instance to a stale timer.
  cancelScheduledCleanup(room);

  room.isResolving = false;

  room.matchInstance = (room.matchInstance ?? 1) + 1;
  // Sprint 1 TASK 3: rotate the instance id so idempotency keys for the
  // previous match never collide with this one (settlement, progression,
  // and cleanup all key off this).
  room.matchInstanceId = generateMatchInstanceId();

  room.picks = {};
  room.round = 1;
  room.phase = "NORMAL";
  room.suddenDeathRound = 0;
  room.matchEnded = false;
  room.matchStartedAt = undefined;
  room.rematchVotes = [];
  room.resultSaved = false;
  room.settlementStarted = false;
  room.progressionApplied = false;
  room.bracketAdvanced = undefined;
  room.stakeSettled = room.stakeAmount > 0;
  room.scores = {};
  room.disconnectedPlayerId = undefined;
  room.disconnectedAt = undefined;
  room.disconnectForfeitTimeout = undefined;
  room.lastActivityAt = Date.now();

  const first = room.players[0];
  const second = room.players[1];

  if (first) {
    room.roles[first.playerId] = "KICKER";
    room.scores[first.playerId] = 0;
    setPlayerActiveRoom(first.playerId, roomCode);
  }

  if (second) {
    room.roles[second.playerId] = "KEEPER";
    room.scores[second.playerId] = 0;
    setPlayerActiveRoom(second.playerId, roomCode);
  }

  deps.emitRoomUpdate(roomCode, room);
  deps.emitMatchState(roomCode, room);
  deps.startRoundTimer(roomCode, room);
}

export function registerRematchHandlers(socket: Socket) {
  const deps = getDeps();

  socket.on(
    "match:rematch",
    ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      if (
        !allowSocketAction(socket.id, "match:rematch", { roomCode, playerId })
      ) {
        return;
      }

      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (!room.matchEnded) return;

      if (deps.isTournamentRoom(room)) {
        socket.emit("error:message", {
          message: "Tournament matches do not allow rematches.",
        });
        return;
      }

      if (room.stakeAmount > 0) {
        socket.emit("error:message", {
          message:
            "Staked rematch is not enabled yet. Return to lobby and create a new offer.",
        });
        return;
      }

      const identity = resolvePlayerForSocket(
        room,
        socket,
        playerId,
        "match:rematch"
      );
      if (!identity.ok) return;

      if (!room.rematchVotes.includes(playerId)) {
        room.rematchVotes.push(playerId);
      }

      deps.io.to(code).emit("match:rematch:update", {
        votes: room.rematchVotes.length,
        required: room.players.length,
        lastRequesterId: playerId,
      });

      if (room.players.length === 2 && room.rematchVotes.length === 2) {
        deps.io.to(code).emit("match:rematch:accepted");
        resetRoomForRematch(code, room);
      }
    }
  );

  socket.on(
    "match:rematch:decline",
    ({
      roomCode,
      playerId,
    }: {
      roomCode: string;
      playerId: string;
    }) => {
      if (
        !allowSocketAction(socket.id, "match:rematch:decline", {
          roomCode,
          playerId,
        })
      ) {
        return;
      }

      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (!room.matchEnded) return;

      if (deps.isTournamentRoom(room)) {
        socket.emit("error:message", {
          message: "Tournament matches do not allow rematches.",
        });
        return;
      }

      const identityDecline = resolvePlayerForSocket(
        room,
        socket,
        playerId,
        "match:rematch:decline"
      );
      if (!identityDecline.ok) return;

      room.rematchVotes = [];

      deps.io.to(code).emit("match:rematch:update", {
        votes: 0,
        required: room.players.length,
        lastRequesterId: null,
      });

      deps.io.to(code).emit("match:rematch:declined", {
        declinedBy: playerId,
      });
    }
  );
}
