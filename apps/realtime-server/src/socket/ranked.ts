import type { Server, Socket } from "socket.io";
import { cleanUsername } from "../room/codes";
import { allowSocketAction } from "../security/rateLimit";
import { rankedQueue } from "../state/stores";
import type { MatchType, Room, RoomPlayer } from "../types/room";

type CreateRoomWithPlayersFn = (
  players: RoomPlayer[],
  maxRounds?: number,
  matchType?: MatchType,
  stakeLabel?: string
) => { code: string; room: Room };

type RankedHandlerDeps = {
  io: Server;
  createRoomWithPlayers: CreateRoomWithPlayersFn;
  getTrackedActiveRoom: (playerId?: string) => string | null;
};

let rankedDeps: RankedHandlerDeps | null = null;

export function bindRankedHandlers(deps: RankedHandlerDeps): void {
  rankedDeps = deps;
}

function getDeps(): RankedHandlerDeps {
  if (!rankedDeps) {
    throw new Error(
      "bindRankedHandlers must be called before ranked queue handlers."
    );
  }
  return rankedDeps;
}

export function removeRankedQueueEntryBySocketId(socketId: string): boolean {
  for (const [playerId, entry] of rankedQueue.entries()) {
    if (entry.socketId === socketId) {
      rankedQueue.delete(playerId);
      return true;
    }
  }
  return false;
}

function tryFlushRankedQueue() {
  const { io, createRoomWithPlayers } = getDeps();

  while (rankedQueue.size >= 2) {
    const ids = Array.from(rankedQueue.keys());
    const idA = ids[0];
    const idB = ids[1];
    if (!idA || !idB) return;

    const a = rankedQueue.get(idA);
    const b = rankedQueue.get(idB);
    if (!a || !b) return;

    rankedQueue.delete(idA);
    rankedQueue.delete(idB);

    const socketA = io.sockets.sockets.get(a.socketId);
    const socketB = io.sockets.sockets.get(b.socketId);
    const okA = Boolean(socketA?.connected);
    const okB = Boolean(socketB?.connected);

    if (!okA && !okB) {
      continue;
    }

    if (okA && !okB) {
      rankedQueue.set(a.playerId, a);
      continue;
    }

    if (!okA && okB) {
      rankedQueue.set(b.playerId, b);
      continue;
    }

    const p1: RoomPlayer = {
      playerId: a.playerId,
      socketId: a.socketId,
      username: a.username,
    };
    const p2: RoomPlayer = {
      playerId: b.playerId,
      socketId: b.socketId,
      username: b.username,
    };

    try {
      const { code } = createRoomWithPlayers([p1, p2], 3, "ranked", "Free");
      io.to(code).emit("ranked:matched", { roomCode: code });
    } catch (error) {
      console.error("tryFlushRankedQueue: failed to create ranked room", error);
      rankedQueue.set(a.playerId, a);
      rankedQueue.set(b.playerId, b);
      break;
    }
  }
}

export function registerRankedHandlers(socket: Socket) {
  const deps = getDeps();

  socket.on(
    "ranked:enqueue",
    ({
      playerId,
      username,
    }: {
      playerId?: string;
      username?: string;
    }) => {
      if (
        !allowSocketAction(socket.id, "ranked:enqueue", {
          playerId: typeof playerId === "string" ? playerId : undefined,
        })
      ) {
        socket.emit("ranked:error", {
          message: "Too many queue attempts. Please wait.",
        });
        return;
      }

      const normalizedId =
        typeof playerId === "string" ? playerId.trim() : "";
      if (!normalizedId) {
        socket.emit("ranked:error", { message: "Missing player ID." });
        return;
      }

      if (typeof username !== "string") {
        socket.emit("ranked:error", { message: "Missing username." });
        return;
      }

      const playerName = cleanUsername(username);

      if (rankedQueue.has(normalizedId)) {
        socket.emit("ranked:error", {
          message: "You are already in the ranked queue.",
        });
        return;
      }

      const busyRoomCode = deps.getTrackedActiveRoom(normalizedId);
      if (busyRoomCode) {
        socket.emit("ranked:error", {
          message: `You are already in an active match (${busyRoomCode}). Finish or leave before queuing ranked.`,
        });
        return;
      }

      rankedQueue.set(normalizedId, {
        playerId: normalizedId,
        username: playerName,
        socketId: socket.id,
        enqueuedAt: Date.now(),
      });

      socket.emit("ranked:queued", {});
      tryFlushRankedQueue();
    }
  );

  socket.on(
    "ranked:cancel",
    ({ playerId }: { playerId?: string }) => {
      const normalizedId =
        typeof playerId === "string" ? playerId.trim() : "";
      if (!normalizedId) {
        socket.emit("ranked:error", { message: "Missing player ID." });
        return;
      }

      if (!rankedQueue.has(normalizedId)) {
        socket.emit("ranked:error", { message: "Not in ranked queue." });
        return;
      }

      const entry = rankedQueue.get(normalizedId);
      if (entry && entry.socketId !== socket.id) {
        socket.emit("ranked:error", {
          message: "Cannot cancel another player's queue entry.",
        });
        return;
      }

      rankedQueue.delete(normalizedId);
      socket.emit("ranked:cancelled", {});
    }
  );
}
