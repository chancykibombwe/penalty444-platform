import { randomUUID } from "crypto";
import type { Server } from "socket.io";
import { playerActiveRooms, rooms } from "../state/stores";
import type { MatchType, Room, RoomPlayer } from "../types/room";
import { getStakeAmount } from "../wallet/stakes";
import { generateRoomCode, normalizeRoomCode } from "./codes";

/**
 * Hardening Sprint (waiting-overlay PR): grace window granted to the
 * absent player to return to the match page once the opponent has
 * arrived. Below this threshold, the lane timer is held back; above
 * it, non-tournament rooms are cancelled with no penalty.
 *
 * 10s is short enough to keep the present player engaged and long
 * enough to cover a tab-switch / reload round trip.
 */
const WAITING_FOR_RETURN_WINDOW_MS = 10_000;

/**
 * Hardening Sprint 1 — TASK 3: stable per-match-instance id. Recomputed
 * on rematch (`resetRoomForRematch` bumps it explicitly).
 */
export function generateMatchInstanceId(): string {
  return randomUUID();
}

export function getTrackedActiveRoom(playerId?: string) {
  if (!playerId) return null;

  const trackedRoomCode = playerActiveRooms.get(playerId);
  if (!trackedRoomCode) return null;

  const room = rooms.get(trackedRoomCode);

  if (!room || room.matchEnded) {
    playerActiveRooms.delete(playerId);
    return null;
  }

  return trackedRoomCode;
}

export function setPlayerActiveRoom(playerId: string, roomCode: string) {
  const code = normalizeRoomCode(roomCode);
  if (!playerId || !code) return;

  playerActiveRooms.set(playerId, code);
  console.log(`[active-room:set] player=${playerId} room=${code}`);
}

export function clearPlayerActiveRoom(playerId?: string) {
  if (!playerId) return;

  playerActiveRooms.delete(playerId);
  console.log(`[active-room:clear] player=${playerId}`);
}

export function clearPlayersActiveRoomsForRoom(room: Room) {
  for (const player of room.players) {
    clearPlayerActiveRoom(player.playerId);
  }
}

export function playerIsBusyInDifferentRoom(
  playerId: string,
  targetRoomCode?: string
) {
  const trackedRoomCode = getTrackedActiveRoom(playerId);
  if (!trackedRoomCode) return null;

  const targetCode = normalizeRoomCode(targetRoomCode);

  if (targetCode && trackedRoomCode === targetCode) {
    return null;
  }

  return trackedRoomCode;
}

type RoomLifecycleDeps = {
  io: Server;
  emitRoomUpdate: (roomCode: string, room: Room) => void;
  emitMatchState: (roomCode: string, room: Room) => void;
  startRoundTimer: (roomCode: string, room: Room) => void;
};

let lifecycleDeps: RoomLifecycleDeps | null = null;

export function bindRoomLifecycle(deps: RoomLifecycleDeps): void {
  lifecycleDeps = deps;
}

function getLifecycleDeps(): RoomLifecycleDeps {
  if (!lifecycleDeps) {
    throw new Error("bindRoomLifecycle must be called before room creation.");
  }
  return lifecycleDeps;
}

export function createRoomWithPlayers(
  players: RoomPlayer[],
  maxRounds = 3,
  matchType: MatchType = "private",
  stakeLabel = "Free"
) {
  const { io, emitRoomUpdate, emitMatchState } = getLifecycleDeps();

  const code = generateRoomCode();
  // Mark every starting player as `present: false`. Presence flips
  // to true only when their `MatchRoomPanel` mounts and emits the
  // explicit `room:join`. Pre-match fairness depends on this.
  const seededPlayers: RoomPlayer[] = players.map((p) => ({
    ...p,
    present: false,
  }));
  const firstPlayer = seededPlayers[0];
  const secondPlayer = seededPlayers[1];
  const stakeAmount = getStakeAmount(stakeLabel);
  const now = Date.now();

  const room: Room = {
    code,
    matchInstance: 1,
    matchInstanceId: generateMatchInstanceId(),
    players: seededPlayers,
    roles: {},
    picks: {},
    scores: {},
    round: 1,
    maxRounds,
    phase: "NORMAL",
    suddenDeathRound: 0,
    rematchVotes: [],
    matchEnded: false,
    matchType,
    stakeLabel,
    stakeAmount,
    stakeSettled: false,
    settlementStarted: false,
    resultSaved: false,
    progressionApplied: false,
    isResolving: false,
    createdAt: now,
    lastActivityAt: now,
    spectatorSocketIds: new Set<string>(),
  };

  if (firstPlayer) {
    room.roles[firstPlayer.playerId] = "KICKER";
    room.scores[firstPlayer.playerId] = 0;
  }

  if (secondPlayer) {
    room.roles[secondPlayer.playerId] = "KEEPER";
    room.scores[secondPlayer.playerId] = 0;
  }

  rooms.set(code, room);

  for (const player of seededPlayers) {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    playerSocket?.join(code);
    setPlayerActiveRoom(player.playerId, code);
  }

  emitRoomUpdate(code, room);
  emitMatchState(code, room);

  // NOTE: we DO NOT call `startRoundTimer` here anymore. The round
  // timer is deferred until both players have explicitly confirmed
  // presence via `room:join`. `evaluateMatchStart` is the single
  // entry point that decides whether to start the timer, arm the
  // return window, or do nothing.
  evaluateMatchStart(code, room);

  return { code, room };
}

export type CreateTournamentRoomParams = {
  players: RoomPlayer[];
  maxRounds?: number;
  tournamentMatchId: string;
  tournamentId: string;
  allowedPlayerIds: string[];
};

/**
 * Creates an in-memory tournament bracket room (no stakes, no rematch / early cancel).
 * Intended for Phase B API / internal bridge; not exposed to clients directly in v1.
 */
export function createTournamentRoom({
  players,
  maxRounds = 3,
  tournamentMatchId,
  tournamentId,
  allowedPlayerIds,
}: CreateTournamentRoomParams) {
  const { io, emitRoomUpdate, emitMatchState } = getLifecycleDeps();

  const normalizedAllowed = allowedPlayerIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (normalizedAllowed.length !== 2) {
    throw new Error(
      "Tournament rooms require exactly two allowed player IDs."
    );
  }

  const uniqueAllowed = new Set(normalizedAllowed);
  if (uniqueAllowed.size !== 2) {
    throw new Error("Tournament allowed player IDs must be distinct.");
  }

  for (const player of players) {
    if (!uniqueAllowed.has(player.playerId.trim())) {
      throw new Error(
        "Initial tournament room players must be in allowedPlayerIds."
      );
    }
  }

  if (players.length > 2) {
    throw new Error("Tournament rooms cannot start with more than two players.");
  }

  const code = generateRoomCode();
  // Mirror `createRoomWithPlayers`: seed presence to false. Tournament
  // rooms also wait for both players to confirm match-page arrival
  // before the timer starts. The return-window cancellation does NOT
  // apply to tournament rooms — see `evaluateMatchStart`.
  const seededPlayers: RoomPlayer[] = players.map((p) => ({
    ...p,
    present: false,
  }));
  const firstPlayer = seededPlayers[0];
  const secondPlayer = seededPlayers[1];
  const now = Date.now();

  const room: Room = {
    code,
    matchInstance: 1,
    matchInstanceId: generateMatchInstanceId(),
    players: seededPlayers,
    roles: {},
    picks: {},
    scores: {},
    round: 1,
    maxRounds,
    phase: "NORMAL",
    suddenDeathRound: 0,
    rematchVotes: [],
    matchEnded: false,
    matchType: "tournament",
    tournamentMatchId,
    tournamentId,
    allowedPlayerIds: normalizedAllowed,
    stakeLabel: "Free",
    stakeAmount: 0,
    stakeSettled: false,
    settlementStarted: false,
    resultSaved: false,
    progressionApplied: false,
    isResolving: false,
    createdAt: now,
    lastActivityAt: now,
    spectatorSocketIds: new Set<string>(),
  };

  if (firstPlayer) {
    room.roles[firstPlayer.playerId] = "KICKER";
    room.scores[firstPlayer.playerId] = 0;
  }

  if (secondPlayer) {
    room.roles[secondPlayer.playerId] = "KEEPER";
    room.scores[secondPlayer.playerId] = 0;
  }

  rooms.set(code, room);

  for (const player of seededPlayers) {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    playerSocket?.join(code);
    setPlayerActiveRoom(player.playerId, code);
  }

  emitRoomUpdate(code, room);
  emitMatchState(code, room);

  // Defer round timer until both players confirm match-page presence
  // through `room:join`. See `createRoomWithPlayers` for rationale.
  evaluateMatchStart(code, room);

  return { code, room };
}

/**
 * The single entry point for "should the round timer start yet?".
 * Called from every event that mutates presence or player count:
 * room creation, `room:join`, `room:leave`, and the pre-start branch
 * of `disconnect`.
 *
 * No-ops once the match has started (`matchStartedAt !== undefined`)
 * so post-start events flow through the existing reconnect-grace path
 * untouched.
 */
export function evaluateMatchStart(roomCode: string, room: Room): void {
  if (room.matchStartedAt !== undefined) return;
  if (room.matchEnded) return;

  if (room.players.length < 2) {
    // Either still waiting for the second slot to fill, or someone
    // truly left the room. In both cases the return-window is no
    // longer applicable.
    clearWaitingForReturn(room);
    return;
  }

  const allPresent = room.players.every((player) => player.present);

  if (allPresent) {
    clearWaitingForReturn(room);
    const { startRoundTimer } = getLifecycleDeps();
    startRoundTimer(roomCode, room);
    return;
  }

  // Two slots filled, but at least one player is absent from the
  // match page. Arm the return window only if it isn't already
  // armed — we don't want repeated `room:leave/room:join` to keep
  // pushing the deadline.
  if (room.waitingForReturnTimeout) return;

  armWaitingForReturn(roomCode, room);
}

/**
 * Sets up the 10s grace window for an absent player to return.
 * Notifies both the present player(s) (overlay message) and the
 * absent player(s) (Match Ready notification at the lobby level).
 *
 * Direct `io.to(socketId).emit()` is used because the absent player
 * has typically already `room:leave`'d, so they're no longer in the
 * room channel — but their socket can still be alive on `/lobby`.
 *
 * For tournament rooms we DO NOT auto-cancel on expiry — those rely
 * on tournament cleanup for no-show handling. We still emit the
 * notifications so the present client can show its overlay.
 */
function armWaitingForReturn(roomCode: string, room: Room): void {
  const { io } = getLifecycleDeps();
  const deadline = Date.now() + WAITING_FOR_RETURN_WINDOW_MS;
  room.waitingForReturnUntil = deadline;

  const presentPlayers = room.players.filter((p) => p.present);
  const absentPlayers = room.players.filter((p) => !p.present);

  const absentName = absentPlayers[0]?.username ?? null;
  const presentName = presentPlayers[0]?.username ?? null;

  for (const p of presentPlayers) {
    io.to(p.socketId).emit("match:waitingForReturn", {
      roomCode,
      expiresAt: deadline,
      absentPlayerName: absentName,
    });
  }

  for (const p of absentPlayers) {
    io.to(p.socketId).emit("match:returnRequested", {
      roomCode,
      expiresAt: deadline,
      opponentName: presentName,
    });
  }

  const isTournament = room.matchType === "tournament";

  room.waitingForReturnTimeout = setTimeout(() => {
    const live = rooms.get(roomCode);
    if (!live) return;
    if (live.matchStartedAt !== undefined) return;
    if (live.matchEnded) return;
    const stillAllPresent = live.players.every((p) => p.present);
    if (stillAllPresent) return;

    // Window expired without both players returning.
    live.waitingForReturnTimeout = undefined;
    live.waitingForReturnUntil = undefined;

    if (isTournament) {
      // Tournament rooms own their own no-show handling via the
      // tournament cleanup tick. We just let the room sit; the
      // present player keeps seeing the waiting overlay.
      console.log(
        `[evaluateMatchStart] tournament return-window expired roomCode=${roomCode} ` +
          `present=${live.players
            .filter((p) => p.present)
            .map((p) => p.playerId)
            .join(",")}`
      );
      return;
    }

    cancelRoomDueToNoReturn(roomCode, live);
  }, WAITING_FOR_RETURN_WINDOW_MS);
}

function clearWaitingForReturn(room: Room): void {
  if (room.waitingForReturnTimeout) {
    clearTimeout(room.waitingForReturnTimeout);
    room.waitingForReturnTimeout = undefined;
  }
  room.waitingForReturnUntil = undefined;
}

/**
 * Hard-cancel for casual / public / ranked rooms when the absent
 * player doesn't come back. No score change, no forfeit, no wallet
 * settlement — the room never officially started, so there's nothing
 * to settle. Both players' active-room locks are cleared so they can
 * immediately start a new match.
 */
function cancelRoomDueToNoReturn(roomCode: string, room: Room): void {
  const { io } = getLifecycleDeps();
  const payload = {
    roomCode,
    reason: "opponent_did_not_return" as const,
    message:
      "Opponent did not return in time. Match cancelled — no penalty.",
  };

  for (const p of room.players) {
    io.to(p.socketId).emit("match:cancelled", payload);
  }
  for (const spectatorSocketId of room.spectatorSocketIds) {
    io.to(spectatorSocketId).emit("match:cancelled", payload);
  }

  clearWaitingForReturn(room);
  clearPlayersActiveRoomsForRoom(room);
  rooms.delete(roomCode);

  console.log(
    `[evaluateMatchStart] room cancelled (no-return) roomCode=${roomCode} ` +
      `matchType=${room.matchType ?? "unknown"}`
  );
}
