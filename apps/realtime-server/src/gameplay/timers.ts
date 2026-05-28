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
  // === Reveal-deadlock instrumentation (logs only, no behaviour change) ===
  //
  // We hypothesize that disconnects landing inside the
  // RESULT_REVEAL_PAUSE_MS window (after `match:result` emit, before
  // continuation fires) silently drop `room.resolveContinuationTimeout`
  // here while `room.isResolving` is still true. The reconnect path
  // then calls `startRoundTimer` without re-arming the continuation,
  // and the room locks permanently with `isResolving === true`.
  //
  // Captures the timer snapshot BEFORE we null any handles so a single
  // log line shows exactly which timers were live at clear time.
  const hadPickTimer = Boolean(room.timeout);
  const hadResolveContinuationTimeout = Boolean(room.resolveContinuationTimeout);
  const hadDisconnectForfeitTimeout = Boolean(room.disconnectForfeitTimeout);
  const hadWaitingForReturnTimeout = Boolean(room.waitingForReturnTimeout);
  const hadStagingCountdownTimeout = Boolean(room.stagingCountdownTimeout);

  console.log(
    `[diag:reveal-deadlock] clearRoomTimer ` +
      `roomCode=${room.code} ` +
      `hadPickTimer=${hadPickTimer} ` +
      `hadResolveContinuationTimeout=${hadResolveContinuationTimeout} ` +
      `hadDisconnectForfeitTimeout=${hadDisconnectForfeitTimeout} ` +
      `hadWaitingForReturnTimeout=${hadWaitingForReturnTimeout} ` +
      `hadStagingCountdownTimeout=${hadStagingCountdownTimeout} ` +
      `isResolving=${Boolean(room.isResolving)} ` +
      `matchStartedAt=${room.matchStartedAt ?? "—"} ` +
      `round=${room.round} ` +
      `phase=${room.phase}`
  );

  if (hadResolveContinuationTimeout && room.isResolving) {
    console.warn(
      `[diag:reveal-deadlock] AUTH_DEADLOCK_CANDIDATE_CLEARING_CONTINUATION ` +
        `roomCode=${room.code} ` +
        `round=${room.round} ` +
        `phase=${room.phase} ` +
        `matchStartedAt=${room.matchStartedAt ?? "—"}`
    );
  }
  // === end instrumentation ===

  clearPickTimer(room);

  if (room.resolveContinuationTimeout) {
    clearTimeout(room.resolveContinuationTimeout);
    room.resolveContinuationTimeout = undefined;

    // `resolveContinuationTimeout` is the only callback that advances
    // the round after `match:result` — it clears `room.isResolving` and
    // resets `room.picks` before calling `startRoundTimer` or `endMatch`.
    // If disconnect (or any other path) calls `clearRoomTimer` while that
    // timer is still pending, we orphan the room: `isResolving` stays true,
    // picks stay locked, and reconnect's `startRoundTimer` arms a pick
    // timer that expires into a permanent `resolveRound` skip. Roll back
    // the orphaned resolution state here so reconnect cannot restart into
    // a poisoned `isResolving === true` room.
    if (room.isResolving) {
      console.warn(
        `[diag:reveal-deadlock] RESETTING_ORPHANED_RESOLUTION_STATE ` +
          `roomCode=${room.code} ` +
          `round=${room.round} ` +
          `phase=${room.phase}`
      );
      room.isResolving = false;
      room.picks = {};
    }
  }
  if (room.disconnectForfeitTimeout) {
    clearTimeout(room.disconnectForfeitTimeout);
    room.disconnectForfeitTimeout = undefined;
  }
  // Phase 6C — pre-match readiness timers. Safe to clear
  // unconditionally; both are only ever armed before
  // `matchStartedAt` is set, but defensive cleanup here keeps
  // `endMatch` / room-sweep paths from leaking handles.
  if (room.waitingForReturnTimeout) {
    clearTimeout(room.waitingForReturnTimeout);
    room.waitingForReturnTimeout = undefined;
  }
  room.waitingForReturnUntil = undefined;
  if (room.stagingCountdownTimeout) {
    clearTimeout(room.stagingCountdownTimeout);
    room.stagingCountdownTimeout = undefined;
  }
  room.stagingStartsAt = undefined;
}

export function startRoundTimer(roomCode: string, room: Room) {
  // === Reveal-deadlock instrumentation (logs only, no behaviour change) ===
  //
  // Hypothesis: the reconnect path in `socket/rooms.ts:room:join`
  // calls `startRoundTimer` unconditionally after clearing the
  // 39s forfeit timer. If a disconnect-during-continuation race has
  // dropped `resolveContinuationTimeout` and left `isResolving=true`,
  // this is where we'd see the bogus pick-timer arm that ultimately
  // expires into a `resolveRound` skip.
  if (room.isResolving) {
    console.warn(
      `[diag:reveal-deadlock] AUTH_DEADLOCK_CANDIDATE_START_TIMER_WHILE_RESOLVING ` +
        `roomCode=${roomCode} ` +
        `round=${room.round} ` +
        `phase=${room.phase} ` +
        `hasKickerPick=${Boolean(room.picks.KICKER)} ` +
        `hasKeeperPick=${Boolean(room.picks.KEEPER)} ` +
        `matchStartedAt=${room.matchStartedAt ?? "—"}`
    );
  }
  // === end instrumentation ===

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
