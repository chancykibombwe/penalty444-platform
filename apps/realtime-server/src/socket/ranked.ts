import type { Server, Socket } from "socket.io";
import { cleanUsername } from "../room/codes";
import { allowSocketAction } from "../security/rateLimit";
import { jwtEnforcementEnabled, jwtMatchesPlayer } from "../security/jwt";
import { requireAuthenticatedSocket } from "../security/socketIdentity";
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
      console.log(
        `[Ranked] cancel playerId=${playerId} socketId=${socketId} ` +
          `queueSize=${rankedQueue.size} reason=disconnected`
      );
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
      console.log(
        `[Ranked] flush skipped reason=both_disconnected ` +
          `playerA=${a.playerId} playerB=${b.playerId} queueSize=${rankedQueue.size}`
      );
      continue;
    }

    if (okA && !okB) {
      console.log(
        `[Ranked] flush skipped reason=partner_disconnected ` +
          `playerId=${a.playerId} disconnectedPlayerId=${b.playerId} queueSize=${rankedQueue.size + 1}`
      );
      rankedQueue.set(a.playerId, a);
      continue;
    }

    if (!okA && okB) {
      console.log(
        `[Ranked] flush skipped reason=partner_disconnected ` +
          `playerId=${b.playerId} disconnectedPlayerId=${a.playerId} queueSize=${rankedQueue.size + 1}`
      );
      rankedQueue.set(b.playerId, b);
      continue;
    }

    const p1: RoomPlayer = {
      playerId: a.playerId,
      socketId: a.socketId,
      username: a.username,
      // Phase 6C — both queued players are still on /lobby at match
      // time. `createRoomWithPlayers` reseeds this anyway; the
      // explicit value satisfies the type contract.
      present: false,
    };
    const p2: RoomPlayer = {
      playerId: b.playerId,
      socketId: b.socketId,
      username: b.username,
      present: false,
    };

    try {
      const { code } = createRoomWithPlayers([p1, p2], 3, "ranked", "Free");
      console.log(
        `[Ranked] matched roomCode=${code} playerA=${a.playerId} ` +
          `playerB=${b.playerId} queueSize=${rankedQueue.size}`
      );
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

      // Phase 8B — an unauthenticated socket (no verified Supabase JWT)
      // must not be able to claim any playerId at all when
      // SOCKET_JWT_ENFORCE=true. jwtMatchesPlayer alone is insufficient
      // here: it returns true for a token-less socket, so the mismatch
      // branch below would never run for an anonymous client.
      const auth = requireAuthenticatedSocket(socket, "ranked:enqueue");
      if (!auth.ok) {
        socket.emit("ranked:error", {
          message: "Authentication required. Please sign in again.",
        });
        return;
      }

      const normalizedId =
        typeof playerId === "string" ? playerId.trim() : "";
      if (!normalizedId) {
        socket.emit("ranked:error", { message: "Missing player ID." });
        return;
      }

      // Sprint 6 — soft JWT cross-check on the queueing player. Strict in
      // enforce mode; logged-only otherwise (same posture as room:create).
      if (!jwtMatchesPlayer(socket, normalizedId)) {
        if (jwtEnforcementEnabled()) {
          console.warn(
            `[Security] ranked:enqueue jwt_player_mismatch socketId=${socket.id} ` +
              `playerId=${normalizedId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
          socket.emit("ranked:error", {
            message: "Authentication mismatch. Please sign in again.",
          });
          return;
        }
        console.warn(
          `[Security] ranked:enqueue jwt_player_mismatch (soft) socketId=${socket.id} ` +
            `playerId=${normalizedId} verifiedUserId=${socket.data.userId ?? "—"}`
        );
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

      console.log(
        `[Ranked] enqueue playerId=${normalizedId} username=${playerName} ` +
          `socketId=${socket.id} queueSize=${rankedQueue.size}`
      );

      socket.emit("ranked:queued", {});
      tryFlushRankedQueue();
    }
  );

  socket.on(
    "ranked:cancel",
    ({ playerId }: { playerId?: string }) => {
      // Phase 8B — same hard-auth gate as ranked:enqueue. An anonymous
      // socket must not be able to claim/cancel any playerId's queue
      // entry when SOCKET_JWT_ENFORCE=true.
      const auth = requireAuthenticatedSocket(socket, "ranked:cancel");
      if (!auth.ok) {
        socket.emit("ranked:error", {
          message: "Authentication required. Please sign in again.",
        });
        return;
      }

      const normalizedId =
        typeof playerId === "string" ? playerId.trim() : "";
      if (!normalizedId) {
        socket.emit("ranked:error", { message: "Missing player ID." });
        return;
      }

      // Sprint 6 — soft JWT cross-check, same posture as ranked:enqueue.
      if (!jwtMatchesPlayer(socket, normalizedId)) {
        if (jwtEnforcementEnabled()) {
          console.warn(
            `[Security] ranked:cancel jwt_player_mismatch socketId=${socket.id} ` +
              `playerId=${normalizedId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
          socket.emit("ranked:error", {
            message: "Authentication mismatch. Please sign in again.",
          });
          return;
        }
        console.warn(
          `[Security] ranked:cancel jwt_player_mismatch (soft) socketId=${socket.id} ` +
            `playerId=${normalizedId} verifiedUserId=${socket.data.userId ?? "—"}`
        );
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

      console.log(
        `[Ranked] cancel playerId=${normalizedId} socketId=${socket.id} ` +
          `queueSize=${rankedQueue.size}`
      );

      socket.emit("ranked:cancelled", {});
    }
  );
}
