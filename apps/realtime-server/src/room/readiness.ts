/**
 * Phase 6C: Presence & Match Readiness Authority.
 *
 * evaluateMatchStart is the SOLE entry point that may begin a round timer.
 * All other paths (room:join, createRoom, reconnect) must go through here
 * when the match has not yet started.
 */

import type { Server } from "socket.io";
import { rooms } from "../state/stores";
import { clearRoomTimer } from "../gameplay/timers";
import { clearPlayersActiveRoomsForRoom } from "./lifecycle";
import { scheduleRoomCleanup } from "./cleanup";
import type { Room } from "../types/room";

const RETURN_WINDOW_MS = 10_000;
const STAGING_SECONDS = 3;

type ReadinessDeps = {
  io: Server;
  startRoundTimer: (roomCode: string, room: Room) => void;
  emitMatchState: (roomCode: string, room: Room) => void;
  emitRoomUpdate: (roomCode: string, room: Room) => void;
};

let readinessDeps: ReadinessDeps | null = null;

export function bindReadinessDeps(deps: ReadinessDeps): void {
  readinessDeps = deps;
}

function getDeps(): ReadinessDeps {
  if (!readinessDeps) {
    throw new Error("bindReadinessDeps must be called before match readiness.");
  }
  return readinessDeps;
}

export function cancelReturnWindow(room: Room): void {
  if (room.returnWindowTimeout) {
    clearTimeout(room.returnWindowTimeout);
    room.returnWindowTimeout = undefined;
    room.returnWindowDeadline = undefined;
  }
}

export function cancelStagingTimeout(room: Room): void {
  if (room.stagingTimeout) {
    clearTimeout(room.stagingTimeout);
    room.stagingTimeout = undefined;
    room.stagingInProgress = false;
  }
}

function cancelMatchNoReturn(roomCode: string, room: Room): void {
  const { io } = getDeps();

  room.matchEnded = true;
  clearRoomTimer(room);
  cancelReturnWindow(room);
  cancelStagingTimeout(room);
  clearPlayersActiveRoomsForRoom(room);

  io.to(roomCode).emit("match:cancelled", {
    roomCode,
    reason: "opponent_no_return",
  });

  console.log(`[Readiness] match cancelled (no return) roomCode=${roomCode}`);
  scheduleRoomCleanup(io, roomCode, "no-return-cancel");
}

function startReturnWindow(roomCode: string, room: Room): void {
  const { io } = getDeps();

  cancelReturnWindow(room);

  room.returnWindowDeadline = Date.now() + RETURN_WINDOW_MS;

  const presentPlayer = room.players.find((p) => p.present);
  const absentPlayer = room.players.find((p) => !p.present);

  if (presentPlayer) {
    const presentSocket = io.sockets.sockets.get(presentPlayer.socketId);
    presentSocket?.emit("match:waitingForOpponent", {
      roomCode,
      deadlineMs: room.returnWindowDeadline,
      opponentName: absentPlayer?.username ?? "Opponent",
    });
    console.log(
      `[Readiness] waitingForOpponent roomCode=${roomCode} presentPlayer=${presentPlayer.playerId}`
    );
  }

  if (absentPlayer) {
    const absentSocket = io.sockets.sockets.get(absentPlayer.socketId);
    absentSocket?.emit("match:opponentReady", {
      roomCode,
      message: "Your opponent is ready. Return to the match.",
      deadlineMs: room.returnWindowDeadline,
    });
    console.log(
      `[Readiness] opponentReady emitted roomCode=${roomCode} absentPlayer=${absentPlayer.playerId}`
    );
  }

  room.returnWindowTimeout = setTimeout(() => {
    const liveRoom = rooms.get(roomCode);
    if (!liveRoom) return;
    if (liveRoom.matchEnded) return;
    if (liveRoom.matchStartedAt !== undefined) return;

    console.log(
      `[Readiness] return window expired roomCode=${roomCode}`
    );
    cancelMatchNoReturn(roomCode, liveRoom);
  }, RETURN_WINDOW_MS);
}

/**
 * THE SOLE AUTHORITY for beginning a round timer.
 *
 * Call this whenever presence state changes (player:present, player:leave,
 * room:join). Does nothing if the match has already started.
 */
export function evaluateMatchStart(roomCode: string, room: Room): void {
  if (room.matchStartedAt !== undefined) return;
  if (room.matchEnded) return;
  if (room.stagingInProgress) return;
  if (room.players.length < 2) return;

  const { io, startRoundTimer, emitMatchState, emitRoomUpdate } = getDeps();

  const allPresent = room.players.every((p) => p.present === true);
  const somePresent = room.players.some((p) => p.present === true);

  if (allPresent) {
    cancelReturnWindow(room);

    room.stagingInProgress = true;

    io.to(roomCode).emit("match:stagingBegin", {
      roomCode,
      seconds: STAGING_SECONDS,
      roles: room.roles,
      players: room.players.map((p) => ({
        playerId: p.playerId,
        username: p.username,
      })),
    });

    emitRoomUpdate(roomCode, room);
    emitMatchState(roomCode, room);

    console.log(
      `[Readiness] staging started roomCode=${roomCode} players=${room.players.map((p) => p.playerId).join(",")}`
    );

    room.stagingTimeout = setTimeout(() => {
      room.stagingTimeout = undefined;
      room.stagingInProgress = false;

      const liveRoom = rooms.get(roomCode);
      if (!liveRoom) return;
      if (liveRoom.matchEnded) return;
      if (liveRoom.matchStartedAt !== undefined) return;

      // Re-verify presence at the moment the countdown ends.
      if (!liveRoom.players.every((p) => p.present === true)) {
        console.log(
          `[Readiness] staging aborted (player left during countdown) roomCode=${roomCode}`
        );
        // Re-evaluate: someone may have left, restart the window logic.
        evaluateMatchStart(roomCode, liveRoom);
        return;
      }

      console.log(
        `[Readiness] staging complete → starting round timer roomCode=${roomCode}`
      );
      startRoundTimer(roomCode, liveRoom);
    }, STAGING_SECONDS * 1000);
  } else if (somePresent) {
    if (!room.returnWindowTimeout) {
      startReturnWindow(roomCode, room);
    }
  } else {
    cancelReturnWindow(room);
  }
}
