import type { Server } from "socket.io";
import { rooms } from "../state/stores";
import type { Room } from "../types/room";
import { clearPlayersActiveRoomsForRoom } from "./lifecycle";

/**
 * Phase 6C — Presence & Match Readiness Authority.
 *
 * `evaluateMatchStart(roomCode, room)` is the SINGLE entry point that
 * decides whether `startRoundTimer` is allowed to fire. It runs after
 * every event that can change presence or player count:
 *
 *   - room creation (`createRoomWithPlayers`, `createTournamentRoom`)
 *   - `room:join`
 *   - `player:present`     (MatchRoomPanel mount / rejoin)
 *   - `player:leave`       (MatchRoomPanel unmount / navigation)
 *   - pre-match `disconnect`
 *
 * It is the ONLY place in the codebase that ever calls
 * `startRoundTimer` directly. Every other call site has been replaced.
 *
 * Fairness model (Phase 6C):
 *
 *  ┌─────────────────────────────────────────────────────┐
 *  │ matchStartedAt set?         → no-op (post-start)    │
 *  │ matchEnded?                 → no-op                 │
 *  │ players.length < 2          → wait quietly          │
 *  │ 2 players, all present      → staging → start       │
 *  │ 2 players, some absent      → arm 10s return window │
 *  └─────────────────────────────────────────────────────┘
 *
 * Staging:
 *  - emit `match:stagingBegin { startsAt, durationMs }` to both
 *    sockets in the room channel
 *  - schedule `startRoundTimer` for `+STAGING_COUNTDOWN_MS`
 *  - if presence drops during staging, abort and rearm the return
 *    window
 *
 * Return window:
 *  - emit `match:waitingForOpponent { expiresAt, absentPlayerName }`
 *    to the present player(s)
 *  - emit `match:opponentReady { expiresAt, opponentName }` direct
 *    to the absent player's last-known socket — drives the global
 *    "Match Ready — Join Now" notification on `/lobby`
 *  - if the window expires without both present, non-tournament
 *    rooms emit `match:cancelled` and are deleted (no penalty);
 *    tournament rooms are left intact (delegated to tournament
 *    cleanup)
 */
export const WAITING_FOR_RETURN_WINDOW_MS = 10_000;
/**
 * Staging countdown window — long enough for the client to render a
 * 3 → 2 → 1 cinematic but short enough that nobody loses focus. The
 * 3700ms figure aligns with the client's 700ms "opponent joined" beat
 * + 3000ms ticker (see `MATCH_WAITING_OPPONENT_JOINED_MS` +
 * `MATCH_WAITING_COUNTDOWN_SECONDS`).
 */
export const STAGING_COUNTDOWN_MS = 3_700;

type ReadinessDeps = {
  io: Server;
  startRoundTimer: (roomCode: string, room: Room) => void;
};

let deps: ReadinessDeps | null = null;

export function bindReadinessAuthority(d: ReadinessDeps): void {
  deps = d;
}

function getDeps(): ReadinessDeps {
  if (!deps) {
    throw new Error(
      "bindReadinessAuthority must be called before evaluateMatchStart."
    );
  }
  return deps;
}

/**
 * Re-evaluates whether the round timer should start, the staging
 * countdown should arm, the return window should arm, or the room
 * should sit quietly. Idempotent — safe to call repeatedly.
 */
export function evaluateMatchStart(roomCode: string, room: Room): void {
  // Post-start: never re-evaluate. `startRoundTimer` already ran;
  // the rest of the match flow (resolveRound / endMatch / rematch)
  // owns timing from here.
  if (room.matchStartedAt !== undefined) return;
  if (room.matchEnded) return;

  if (room.players.length < 2) {
    // Either still waiting for the second slot to fill, or someone
    // truly left the room. Either way, no return window applicable.
    clearReturnWindow(room);
    // If we were in staging when this happened, abort it.
    abortStaging(room);
    return;
  }

  const allPresent = room.players.every((player) => player.present);

  if (allPresent) {
    clearReturnWindow(room);
    // If staging is already armed, leave it alone — let it complete.
    // Otherwise, start staging now.
    if (room.stagingCountdownTimeout) return;
    armStaging(roomCode, room);
    return;
  }

  // Two slots filled, but at least one player is absent. If staging
  // was running, abort it (the absent player must come back from the
  // start). Then arm the return window if it isn't already armed.
  abortStaging(room);
  if (room.waitingForReturnTimeout) return;
  armReturnWindow(roomCode, room);
}

/**
 * Arms the 3.7s staging countdown and schedules `startRoundTimer` to
 * fire when it elapses.
 */
function armStaging(roomCode: string, room: Room): void {
  const { io, startRoundTimer } = getDeps();
  const now = Date.now();

  room.stagingStartsAt = now;

  io.to(roomCode).emit("match:stagingBegin", {
    roomCode,
    startsAt: now,
    durationMs: STAGING_COUNTDOWN_MS,
  });

  console.log(
    `[readiness] staging armed roomCode=${roomCode} ` +
      `players=${room.players.map((p) => p.playerId).join(",")} ` +
      `durationMs=${STAGING_COUNTDOWN_MS}`
  );

  room.stagingCountdownTimeout = setTimeout(() => {
    const live = rooms.get(roomCode);
    if (!live) return;
    if (live.matchStartedAt !== undefined) return;
    if (live.matchEnded) return;

    // Defensive re-check: someone could have left during staging
    // (`abortStaging` would normally clear this timer, but a race
    // between abort and the timer firing could land us here with
    // not-everyone-present).
    const stillAllPresent = live.players.every((p) => p.present);
    if (!stillAllPresent || live.players.length < 2) {
      live.stagingCountdownTimeout = undefined;
      live.stagingStartsAt = undefined;
      // Re-evaluate — likely will arm the return window.
      evaluateMatchStart(roomCode, live);
      return;
    }

    live.stagingCountdownTimeout = undefined;
    live.stagingStartsAt = undefined;
    startRoundTimer(roomCode, live);
  }, STAGING_COUNTDOWN_MS);
}

function abortStaging(room: Room): void {
  if (room.stagingCountdownTimeout) {
    clearTimeout(room.stagingCountdownTimeout);
    room.stagingCountdownTimeout = undefined;
  }
  room.stagingStartsAt = undefined;
}

/**
 * Arms the 10s return window. Notifies the present player(s) via the
 * room channel, and the absent player(s) direct to their socket so
 * the lobby-level notification can fire even though they've already
 * left the room channel.
 */
function armReturnWindow(roomCode: string, room: Room): void {
  const { io } = getDeps();
  const deadline = Date.now() + WAITING_FOR_RETURN_WINDOW_MS;
  room.waitingForReturnUntil = deadline;

  const presentPlayers = room.players.filter((p) => p.present);
  const absentPlayers = room.players.filter((p) => !p.present);

  const absentName = absentPlayers[0]?.username ?? null;
  const presentName = presentPlayers[0]?.username ?? null;

  for (const p of presentPlayers) {
    io.to(p.socketId).emit("match:waitingForOpponent", {
      roomCode,
      expiresAt: deadline,
      absentPlayerName: absentName,
    });
  }

  for (const p of absentPlayers) {
    // Direct emit — the absent player may have `room:leave`d their
    // socket-io channel; we still have their last known socketId.
    io.to(p.socketId).emit("match:opponentReady", {
      roomCode,
      expiresAt: deadline,
      opponentName: presentName,
    });
  }

  const isTournament = room.matchType === "tournament";

  console.log(
    `[readiness] return window armed roomCode=${roomCode} ` +
      `present=${presentPlayers.map((p) => p.playerId).join(",")} ` +
      `absent=${absentPlayers.map((p) => p.playerId).join(",")} ` +
      `tournament=${isTournament} expiresAt=${deadline}`
  );

  room.waitingForReturnTimeout = setTimeout(() => {
    const live = rooms.get(roomCode);
    if (!live) return;
    if (live.matchStartedAt !== undefined) return;
    if (live.matchEnded) return;

    const stillAllPresent = live.players.every((p) => p.present);
    if (stillAllPresent) {
      // Race: presence recovered just before the timer fired.
      // `evaluateMatchStart` would normally already have cleared us;
      // belt-and-braces guard.
      return;
    }

    live.waitingForReturnTimeout = undefined;
    live.waitingForReturnUntil = undefined;

    if (isTournament) {
      // Tournament rooms own their own no-show handling via the
      // tournament cleanup tick. The room is left in place; the
      // present client keeps seeing the waiting overlay until that
      // path resolves.
      console.log(
        `[readiness] tournament return window expired roomCode=${roomCode} ` +
          `— deferring to tournament cleanup`
      );
      return;
    }

    cancelRoomDueToNoReturn(roomCode, live);
  }, WAITING_FOR_RETURN_WINDOW_MS);
}

function clearReturnWindow(room: Room): void {
  if (room.waitingForReturnTimeout) {
    clearTimeout(room.waitingForReturnTimeout);
    room.waitingForReturnTimeout = undefined;
  }
  room.waitingForReturnUntil = undefined;
}

/**
 * Hard-cancel for casual / public / ranked rooms when the absent
 * player doesn't come back. No score change, no forfeit, no wallet
 * settlement — the room never officially started, so there's
 * nothing to settle. Both players' active-room locks are released
 * so they can immediately start a new match.
 */
function cancelRoomDueToNoReturn(roomCode: string, room: Room): void {
  const { io } = getDeps();

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

  clearReturnWindow(room);
  abortStaging(room);
  clearPlayersActiveRoomsForRoom(room);
  rooms.delete(roomCode);

  console.log(
    `[readiness] room cancelled (no return) roomCode=${roomCode} ` +
      `matchType=${room.matchType ?? "unknown"}`
  );
}

/**
 * Cleanup helper for `clearRoomTimer` so post-match teardown
 * doesn't leak readiness timers.
 */
export function clearReadinessTimers(room: Room): void {
  clearReturnWindow(room);
  abortStaging(room);
}
