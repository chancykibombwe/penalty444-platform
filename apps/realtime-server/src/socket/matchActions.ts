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
import { isValidLane, summarizeForLog } from "../security/validation";
import { rooms } from "../state/stores";
import type { Room } from "../types/room";

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
    (payload: unknown) => {
      // Defensive payload shape check. Anything that isn't a plain
      // object is dropped immediately — the previous handler used
      // destructuring, which would silently produce `undefined`s
      // and feed garbage into validators below.
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return;
      }
      const { roomCode, lane, playerId, matchInstance, clientEventId } =
        payload as {
          roomCode?: unknown;
          lane?: unknown;
          playerId?: unknown;
          matchInstance?: unknown;
          clientEventId?: unknown;
        };

      // Sprint 4 TASK 13: rate-limit before any state work. We coerce
      // the wire roomCode/playerId to a safe shape only for the rate
      // limit context; the real validation comes after.
      const rateContext = {
        roomCode: typeof roomCode === "string" ? roomCode : undefined,
        playerId: typeof playerId === "string" ? playerId : undefined,
      };
      if (!allowSocketAction(socket.id, "match:pick", rateContext)) {
        return;
      }

      // Hotfix Sprint TASK 1+2: runtime lane validation.
      //
      // BEFORE this guard a malicious kicker could emit
      //   lane: "GUARANTEED_GOAL"
      // and force every round to GOAL because resolveShot() only
      // tests lane equality. The guard runs BEFORE any room state is
      // mutated and BEFORE we touch picks, so even a hostile flood
      // can never corrupt `room.picks`.
      if (!isValidLane(lane)) {
        console.warn(
          `[Security] invalid lane rejected action=match:pick socketId=${socket.id} ` +
            `roomCode=${rateContext.roomCode ?? "—"} typeofLane=${typeof lane} ` +
            `value=${summarizeForLog(lane)}`
        );
        return;
      }
      // From here on `lane` is narrowed to `Lane` by the type guard.

      // playerId / roomCode shape — required for everything downstream.
      if (typeof playerId !== "string" || playerId.trim().length === 0) return;
      if (typeof roomCode !== "string" || roomCode.trim().length === 0) return;

      const code = normalizeRoomCode(roomCode);
      const room = rooms.get(code);

      if (!room) return;
      if (room.matchEnded) return;
      if (room.isResolving) return;
      if (room.disconnectedPlayerId === playerId) return;

      // Sprint 4 TASK 5: stale matchInstance rejection. Only enforced
      // when the client opts in by sending it.
      if (matchInstance !== undefined) {
        if (typeof matchInstance !== "number" || !Number.isFinite(matchInstance)) {
          // Hotfix Sprint TASK 1: a non-numeric matchInstance is a
          // malformed payload — drop rather than ignore so debugging
          // is easier.
          return;
        }
        if (room.matchInstance !== matchInstance) {
          console.warn(
            `[Security] match:pick stale matchInstance roomCode=${code} ` +
              `playerId=${playerId} expected=${room.matchInstance} got=${matchInstance}`
          );
          return;
        }
      }

      // Hotfix Sprint TASK 5: replay guard.
      //
      // Sprint 4 only deduped when the client volunteered a
      // `clientEventId`. We now ALSO synthesize a deterministic
      // dedupe key from `(matchInstance, round, role-derived-later)`
      // so the same socket can't replay-spam the same round of the
      // same instance even when no client id was sent.
      //
      // The role isn't known until `ensureAuthoritativeRoomRoles` /
      // `room.roles[playerId]`, so we compute the synthetic id below
      // after we have the role. The CLIENT-supplied id (if present)
      // is checked here so we can short-circuit faster.
      if (
        typeof clientEventId === "string" &&
        clientEventId.length > 0 &&
        hasSeenEvent(code, socket.id, clientEventId)
      ) {
        console.warn(
          `[Security] replay rejected action=match:pick socketId=${socket.id} ` +
            `roomCode=${code} clientEventId=${summarizeForLog(clientEventId)}`
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

      // Hotfix Sprint TASK 5: synthesize a server-side dedupe key
      // when the client didn't send one. Format is intentionally
      // distinct from any client-issuable id so the two namespaces
      // never collide.
      const syntheticEventId = `synth:${room.matchInstance}:${room.round}:${role}`;
      if (
        (!clientEventId || typeof clientEventId !== "string") &&
        hasSeenEvent(code, socket.id, syntheticEventId)
      ) {
        console.warn(
          `[Security] replay rejected (synth) action=match:pick socketId=${socket.id} ` +
            `roomCode=${code} round=${room.round} role=${role}`
        );
        return;
      }

      if (typeof clientEventId === "string" && clientEventId.length > 0) {
        markEventSeen(code, socket.id, clientEventId);
      } else {
        markEventSeen(code, socket.id, syntheticEventId);
      }

      // Safe assignment — `lane` is now narrowed to `Lane` by
      // `isValidLane()` and the role/round guards above guarantee
      // `room.picks[role]` is unset.
      room.picks[role] = lane;
      touchRoomActivity(room);

      // Reconnect/refresh diagnostic. Logs only the booleans, never the
      // lane the opponent picked — keeps spectator/opponent secrecy intact.
      console.log(
        `[match:pick] accepted roomCode=${code} socketId=${socket.id} playerId=${playerId} ` +
          `role=${role} round=${room.round} phase=${room.phase} ` +
          `kickerLocked=${Boolean(room.picks.KICKER)} keeperLocked=${Boolean(room.picks.KEEPER)}`
      );

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
