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

/**
 * Options for {@link clearRoomTimer}.
 *
 * Strict-disconnect policy: when a player drops mid-resolve (both picks
 * already locked, continuation pending) we MUST NOT clear the
 * continuation timer — that callback owns advancing the round / ending
 * the match. The default behaviour stays "tear everything down", which
 * remains the right choice for `endMatch`, `abortMatchEarly`, rematch
 * reset, and cleanup-sweep callers. Disconnect handlers that detect a
 * resolving room opt into `preserveResolution: true`.
 */
export type ClearRoomTimerOptions = {
  /**
   * Skip clearing `resolveContinuationTimeout` (and the orphan-reset
   * rollback that piggy-backs on it). Used by the disconnect handler
   * when both picks are already locked / `room.isResolving === true`,
   * so reveal/result/next-round continues without disruption.
   */
  preserveResolution?: boolean;
};

export function clearRoomTimer(
  room: Room,
  opts: ClearRoomTimerOptions = {}
) {
  const { preserveResolution = false } = opts;

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
      `preserveResolution=${preserveResolution} ` +
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

  if (hadResolveContinuationTimeout && room.isResolving && !preserveResolution) {
    console.warn(
      `[diag:reveal-deadlock] AUTH_DEADLOCK_CANDIDATE_CLEARING_CONTINUATION ` +
        `roomCode=${room.code} ` +
        `round=${room.round} ` +
        `phase=${room.phase} ` +
        `matchStartedAt=${room.matchStartedAt ?? "—"}`
    );
  }
  // === end instrumentation ===

  // Pick timer is safe to clear in either mode:
  //   - In resolving mode it's already cleared by `resolveRound`.
  //   - In non-resolving mode this is the standard pause path.
  // We deliberately skip it under `preserveResolution` anyway, because
  // an unexpectedly live pick timer here would only be a bug we want
  // to surface via the existing diagnostic logs, not silently squash.
  if (!preserveResolution) {
    clearPickTimer(room);
  }

  if (!preserveResolution && room.resolveContinuationTimeout) {
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
    room.disconnectForfeitExpiresAt = undefined;
    // Bump generation so any in-flight forfeit callback that already
    // passed the `clearTimeout` race still no-ops against the live room.
    room.disconnectForfeitGeneration =
      (room.disconnectForfeitGeneration ?? 0) + 1;
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

  // Defensive grace guard: never start a pick timer while a disconnect
  // forfeit grace window is still live. The authoritative resume paths
  // (`tryResumeAfterDisconnectGrace`) clear grace BEFORE calling
  // `startRoundTimer`, so this only blocks stray callers that would
  // otherwise race the grace window — preventing a 10s pick timer from
  // overwriting the 39s reconnect countdown.
  if (
    room.disconnectForfeitExpiresAt !== undefined &&
    Date.now() < room.disconnectForfeitExpiresAt &&
    room.disconnectedPlayerId !== undefined
  ) {
    console.warn(
      `[diag:disconnect-grace] SKIP_START_TIMER_GRACE_ACTIVE ` +
        `roomCode=${roomCode} disconnectedPlayerId=${room.disconnectedPlayerId} ` +
        `round=${room.round} phase=${room.phase} ` +
        `expiresAt=${room.disconnectForfeitExpiresAt} now=${Date.now()}`
    );
    return;
  }

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
