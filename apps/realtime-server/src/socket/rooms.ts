import type { Server, Socket } from "socket.io";
import { tryResumeAfterDisconnectGrace } from "../gameplay/disconnectGrace";
import { cleanUsername, normalizeRoomCode } from "../room/codes";
import { evaluateMatchStart } from "../room/readiness";
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
  endMatch: (roomCode: string, room: Room) => void;
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
            // Phase 6C — creator is still on /lobby at room-create
            // time. Presence flips to true on the subsequent
            // `player:present` from MatchRoomPanel's mount.
            present: false,
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

        // Strict-disconnect policy follow-up:
        //
        // The returning socket MUST join the room channel BEFORE we
        // can call `startRoundTimer` or emit any `io.to(code)` events
        // tied to the reconnect. Previously `socket.join(code)` came
        // after the conditional `startRoundTimer` call below, so the
        // reconnecting client missed the authoritative
        // `match:status { timeoutSeconds: 10 }` emit and rendered a
        // blank / stale countdown while the server-side pick timer
        // was running. Hoisting the channel join (and the `room:joined`
        // ack) here makes every subsequent `io.to(code).emit(...)`
        // observable by the reconnecting client.
        socket.join(code);
        socket.emit("room:joined", { roomCode: code });

        if (room.disconnectedPlayerId === playerId) {
          // === Reveal-deadlock instrumentation (logs only) ===
          console.log(
            `[diag:reveal-deadlock] AUTH_DEADLOCK_TRACE_RECONNECT_RESTART_TIMER ` +
              `roomCode=${code} ` +
              `playerId=${playerId} ` +
              `isResolving=${Boolean(room.isResolving)} ` +
              `hasContinuationTimeout=${Boolean(room.resolveContinuationTimeout)} ` +
              `round=${room.round} ` +
              `phase=${room.phase} ` +
              `hasKickerPick=${Boolean(room.picks.KICKER)} ` +
              `hasKeeperPick=${Boolean(room.picks.KEEPER)}`
          );
          // === end instrumentation ===

          tryResumeAfterDisconnectGrace(
            deps.io,
            code,
            room,
            playerId,
            deps.startRoundTimer,
            deps.endMatch
          );
        }

        // Channel join + `room:joined` ack happen ABOVE, before the
        // reconnect block, so the conditional `startRoundTimer`
        // emit reaches the returning socket.
        deps.emitRoomUpdate(code, room);
        deps.emitMatchState(code, room);

        // Reconnect/refresh fix: send a per-socket authoritative snapshot
        // so the rejoining client knows whether THEY have already locked a
        // pick this round, and whether the opponent has locked (boolean
        // only). Without this, a refresh between picks lets the UI re-enable
        // pick buttons even though the server still holds the previous
        // pick, leaving the player stuck after the next click is silently
        // dropped by match:pick's "already picked" guard.
        //
        // Lane data is only sent to the player who owns it. Opponent picks
        // are NEVER leaked here — only the boolean `opponentHasLocked`.
        const myRole = room.roles[playerId];
        const opponentRole =
          myRole === "KICKER" ? "KEEPER" : myRole === "KEEPER" ? "KICKER" : null;
        const rejoinPayload = {
          roomCode: code,
          myRole: myRole ?? null,
          myPick: myRole ? (room.picks[myRole] ?? null) : null,
          opponentHasLocked: opponentRole
            ? Boolean(room.picks[opponentRole])
            : false,
          round: room.round,
          phase: room.phase,
          suddenDeathRound: room.suddenDeathRound,
          matchInstance: room.matchInstance ?? 1,
          matchEnded: Boolean(room.matchEnded),
          isResolving: Boolean(room.isResolving),
        };
        socket.emit("match:rejoinState", rejoinPayload);
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
        // Phase 6C — accepting player has just received `room:joined`
        // but their `MatchRoomPanel` hasn't mounted yet. Presence
        // stays false until the client emits `player:present`.
        present: false,
      });

      room.roles[playerId] = "KEEPER";
      room.scores[playerId] = 0;

      deps.setPlayerActiveRoom(playerId, code);

      socket.join(code);
      socket.emit("room:joined", { roomCode: code });

      deps.emitRoomUpdate(code, room);
      deps.emitMatchState(code, room);

      // Phase 6C — the readiness authority is the SOLE caller of
      // `startRoundTimer`. The previous unconditional
      // `if (players.length === 2) startRoundTimer(...)` was the
      // root cause of the unfair "creator absent, timer started"
      // race we're fixing here.
      evaluateMatchStart(code, room);
    }
  );

  // Phase 6C — explicit match-page presence events.
  //
  // The client's `MatchRoomPanel` emits `player:present` on mount /
  // rejoin and `player:leave` on unmount / navigation. These are
  // distinct from socket.io channel joins/leaves — a player can be
  // in the channel without their match panel being mounted (e.g.
  // they refreshed and routed back to /lobby while the socket
  // reconnect was still in flight). The readiness authority uses
  // ONLY the per-player `present` flag to decide whether the round
  // timer is allowed to start.

  socket.on(
    "player:present",
    ({
      roomCode,
      playerId,
    }: {
      roomCode?: string;
      playerId?: string;
    }) => {
      if (!allowSocketAction(socket.id, "player:present", { roomCode, playerId })) {
        return;
      }
      if (typeof roomCode !== "string" || typeof playerId !== "string") return;

      const code = normalizeRoomCode(roomCode);
      if (!code) return;

      const room = rooms.get(code);
      if (!room) return;

      // JWT cross-check — same posture as `room:join`.
      if (!jwtMatchesPlayer(socket, playerId)) {
        if (jwtEnforcementEnabled()) {
          console.warn(
            `[Security] player:present jwt_player_mismatch socketId=${socket.id} ` +
              `playerId=${playerId} verifiedUserId=${socket.data.userId ?? "—"}`
          );
          return;
        }
      }

      const player = room.players.find((p) => p.playerId === playerId);
      if (!player) return;

      // Refresh the bound socketId — the client may have reconnected
      // with a fresh socket between `room:join` and `player:present`.
      player.socketId = socket.id;
      player.present = true;

      console.log(
        `[presence] player:present roomCode=${code} playerId=${playerId} ` +
          `playerCount=${room.players.length} ` +
          `allPresent=${room.players.every((p) => p.present)}`
      );

      // Next-round / mid-round disconnect grace may still be armed when
      // the client emits `player:present`. We MUST NOT resume grace
      // (which can call `startRoundTimer` → `io.to(code).emit(... timeoutSeconds: 10)`)
      // unless THIS socket is already in the Socket.IO room channel.
      //
      // If `player:present` arrives before the socket has joined the
      // room (the client emits presence on mount, and the reconnect
      // `room:join` channel-join may not have completed yet), an
      // `io.to(code)` timer emit would not reach the returning socket —
      // recreating the "returned player sees a blank/stale timer and
      // loses while the server timer runs" bug.
      //
      // `room:join` is the authoritative resume path: it calls
      // `socket.join(code)` FIRST, then resumes grace. So here we only
      // resume when the channel membership is already established;
      // otherwise we just mark presence and defer to `room:join`.
      if (socket.rooms.has(code)) {
        tryResumeAfterDisconnectGrace(
          deps.io,
          code,
          room,
          playerId,
          deps.startRoundTimer,
          deps.endMatch
        );
      } else {
        console.log(
          `[diag:disconnect-grace] PRESENT_RESUME_DEFERRED_NOT_IN_ROOM ` +
            `roomCode=${code} playerId=${playerId} socketId=${socket.id}`
        );
      }

      evaluateMatchStart(code, room);
    }
  );

  socket.on(
    "player:leave",
    ({
      roomCode,
      playerId,
    }: {
      roomCode?: string;
      playerId?: string;
    }) => {
      if (!allowSocketAction(socket.id, "player:leave", { roomCode, playerId })) {
        return;
      }
      if (typeof roomCode !== "string" || typeof playerId !== "string") return;

      const code = normalizeRoomCode(roomCode);
      if (!code) return;

      const room = rooms.get(code);
      if (!room) return;

      const player = room.players.find((p) => p.playerId === playerId);
      if (!player) return;

      // Only drop presence when the leaving player matches this
      // socket — protects against a stray emit from another tab.
      if (player.socketId !== socket.id) return;

      player.present = false;

      console.log(
        `[presence] player:leave roomCode=${code} playerId=${playerId} ` +
          `playerCount=${room.players.length}`
      );

      evaluateMatchStart(code, room);
    }
  );
}
