import type { Server } from "socket.io";
import { PICK_TIMEOUT_MS } from "../config";
import { rooms } from "../state/stores";
import type { Room } from "../types/room";

type RoundTimerDeps = {
  io: Server;
  resolveRound: (roomCode: string, room: Room, fromTimeout?: boolean) => void;
};

/** Invalidates in-flight pick timeouts when a round is cleared early. */
const pickTimerEpochByRoomCode = new Map<string, number>();

function bumpPickTimerEpoch(roomCode: string): number {
  const next = (pickTimerEpochByRoomCode.get(roomCode) ?? 0) + 1;
  pickTimerEpochByRoomCode.set(roomCode, next);
  return next;
}

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

export function clearPickTimer(room: Room) {
  if (room.code) {
    bumpPickTimerEpoch(room.code);
  }

  if (room.timeout) {
    clearTimeout(room.timeout);
    room.timeout = undefined;
  }
}

export function clearRoomTimer(room: Room) {
  clearPickTimer(room);

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
  clearPickTimer(room);

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

  const pickEpoch = bumpPickTimerEpoch(roomCode);

  room.timeout = setTimeout(() => {
    const liveRoom = rooms.get(roomCode);
    if (!liveRoom) {
      return;
    }

    if (pickTimerEpochByRoomCode.get(roomCode) !== pickEpoch) {
      return;
    }

    resolveRound(roomCode, liveRoom, true);
  }, PICK_TIMEOUT_MS);
}
