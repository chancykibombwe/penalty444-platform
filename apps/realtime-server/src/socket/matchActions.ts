import type { Server, Socket } from "socket.io";
import { EARLY_CANCEL_MS } from "../config";
import { ensureAuthoritativeRoomRoles } from "../gameplay/resolveShot";
import { clearPickTimer } from "../gameplay/timers";
import { normalizeRoomCode } from "../room/codes";
import { touchRoomActivity } from "../room/cleanup";
import { resolvePlayerForSocket } from "../security/identity";
import { allowSocketAction } from "../security/rateLimit";
import {
  hasSeenEvent,
  markEventSeen,
} from "../security/replayGuard";
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
      matchInstance,
      clientEventId,
    }: {
      roomCode: string;
      lane: Lane;
      playerId: string;
      /**
       * Sprint 4 TASK 5: optional. When present, server compares against
       * `room.matchInstance` and rejects stale picks (e.g. a stray emit
       * from a previous match landing on a fresh rematch).
       */
      matchInstance?: number;
      /**
       * Sprint 4 TASK 6: optional client-supplied dedupe id. When the
       * same id arrives twice for the same (room, socket) we silently
       * drop the duplicate.
       */
      clientEventId?: string;
    }) => {
      // Sprint 4 TASK 13: rate-limit before any state work.
      if (
        !allowSocketAction(socket.id, "match:pick", { roomCode, playerId })
      ) {
        return;
      }

      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (room.matchEnded) return;
      if (room.isResolving) return;
      if (room.disconnectedPlayerId === playerId) return;

      // Sprint 4 TASK 5: stale matchInstance rejection. Only enforced
      // when the client opts in by sending it.
      if (
        typeof matchInstance === "number" &&
        Number.isFinite(matchInstance) &&
        room.matchInstance !== matchInstance
      ) {
        console.warn(
          `[Security] match:pick stale matchInstance roomCode=${code} ` +
            `playerId=${playerId} expected=${room.matchInstance} got=${matchInstance}`
        );
        return;
      }

      // Sprint 4 TASK 6: replay-guard for clients that supply an id.
      if (
        typeof clientEventId === "string" &&
        clientEventId.length > 0 &&
        hasSeenEvent(code, socket.id, clientEventId)
      ) {
        console.warn(
          `[Security] replay rejected action=match:pick socketId=${socket.id} ` +
            `roomCode=${code} clientEventId=${clientEventId}`
        );
        return;
      }

      // Sprint 1 TASK 2: socket must own the player it claims to be.
      const identity = resolvePlayerForSocket(
        room,
        socket,
        playerId,
        "match:pick"
      );
      if (!identity.ok) return;

      ensureAuthoritativeRoomRoles(room);

      const role = room.roles[playerId];

      if (!role) return;
      if (room.picks[role]) return;

      if (typeof clientEventId === "string" && clientEventId.length > 0) {
        markEventSeen(code, socket.id, clientEventId);
      }

      room.picks[role] = lane;
      touchRoomActivity(room);

      deps.io.to(code).emit("match:status", {
        roomCode: code,
        message: `${
          room.players.find((player) => player.playerId === playerId)
            ?.username || "Player"
        } locked pick.`,
        phase: room.phase,
        suddenDeathRound: room.suddenDeathRound,
      });

      if (room.picks.KICKER && room.picks.KEEPER) {
        console.log(
          `[both-picks] clearing timer and resolving round room=${code} round=${room.round} kickerPick=${room.picks.KICKER} keeperPick=${room.picks.KEEPER}`
        );
        clearPickTimer(room);

        const liveRoom = rooms.get(code);
        if (!liveRoom || liveRoom.isResolving) {
          return;
        }

        deps.resolveRound(code, liveRoom);
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
      if (
        !allowSocketAction(socket.id, "match:abortEarly", {
          roomCode,
          playerId,
        })
      ) {
        return;
      }

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

      const identity = resolvePlayerForSocket(
        room,
        socket,
        playerId,
        "match:abortEarly"
      );
      if (!identity.ok) {
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
      if (
        !allowSocketAction(socket.id, "match:forfeit", { roomCode, playerId })
      ) {
        return;
      }

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

      const identity = resolvePlayerForSocket(
        room,
        socket,
        playerId,
        "match:forfeit"
      );
      if (!identity.ok) {
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
