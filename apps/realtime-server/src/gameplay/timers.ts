import type { Server } from "socket.io";
import { PICK_TIMEOUT_MS } from "../config";
import type { Room } from "../types/room";

type RoundTimerDeps = {
  io: Server;
  resolveRound: (roomCode: string, room: Room, fromTimeout?: boolean) => void;
};

let timerDeps: RoundTimerDeps | null = null;

export function bindRoundTimers(deps: RoundTimerDeps): void {
  timerDeps = deps;
}

function getTimerDeps(): RoundTimerDeps {
  if (!timerDeps) {
    throw new Error("bindRoundTimers must be called before round timers.");
  }
  return timerDeps;
}

export function clearRoomTimer(room: Room) {
  if (room.timeout) {
    clearTimeout(room.timeout);
    room.timeout = undefined;
  }
  if (room.resolveContinuationTimeout) {
    clearTimeout(room.resolveContinuationTimeout);
    room.resolveContinuationTimeout = undefined;
  }
  if (room.disconnectForfeitTimeout) {
    clearTimeout(room.disconnectForfeitTimeout);
    room.disconnectForfeitTimeout = undefined;
  }
}

export function startRoundTimer(roomCode: string, room: Room) {
  clearRoomTimer(room);

  if (room.matchEnded) return;
  if (room.players.length < 2) return;

  if (room.matchStartedAt === undefined) {
    room.matchStartedAt = Date.now();
  }

  const { io, resolveRound } = getTimerDeps();

  io.to(roomCode).emit("match:status", {
    message:
      room.phase === "SUDDEN_DEATH"
        ? `Sudden Death ${room.suddenDeathRound}. You have 10 seconds to act.`
        : "New round started. You have 10 seconds to act.",
    timeoutSeconds: 10,
    phase: room.phase,
    suddenDeathRound: room.suddenDeathRound,
  });

  room.timeout = setTimeout(() => {
    resolveRound(roomCode, room, true);
  }, PICK_TIMEOUT_MS);
}
