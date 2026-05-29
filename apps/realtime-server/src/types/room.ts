export type Lane = "LEFT" | "CENTER" | "RIGHT";
export type Role = "KICKER" | "KEEPER";
export type ShotResult = "GOAL" | "SAVE" | "DRAW";
export type MatchType = "private" | "public" | "ranked" | "tournament" | "unknown";
export type MatchPhase = "NORMAL" | "SUDDEN_DEATH";

export type RoomPlayer = {
  playerId: string;
  socketId: string;
  username: string;
  /**
   * Phase 6C — match-page presence.
   *
   * `true` only while the player has an active `MatchRoomPanel`
   * mounted (the panel emits `player:present` on mount and
   * `player:leave` on unmount/navigation). `false` on pre-match
   * disconnect.
   *
   * Distinct from "has a live socket": a player can be on `/lobby`
   * with a healthy socket, but `present === false`. The readiness
   * authority (`room/readiness.ts`) uses this — and ONLY this — to
   * decide whether the round timer is allowed to start.
   */
  present: boolean;
};

export type Room = {
  code: string;
  /** Increments when a rematch starts in the same room; pairs with room_code for saved rows. */
  matchInstance: number;
  /**
   * Hardening (Sprint 1, TASK 3): stable per-match-instance id used for
   * idempotency keys. Generated when a match starts; rotated when a rematch
   * resets the room. Lets cleanup, settlement, and progression compare the
   * exact instance they were scheduled against the currently active one.
   */
  matchInstanceId: string;
  players: RoomPlayer[];
  roles: Record<string, Role>;
  picks: Partial<Record<Role, Lane>>;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  phase: MatchPhase;
  suddenDeathRound: number;
  rematchVotes: string[];
  matchEnded: boolean;
  /** Set once when the first pick-round timer starts (2 players). */
  matchStartedAt?: number;
  matchType: MatchType;
  tournamentMatchId?: string;
  tournamentId?: string;
  /** Auth user ids allowed in this bracket slot (exactly two for v1). */
  allowedPlayerIds?: string[];
  stakeLabel: string;
  stakeAmount: number;
  stakeSettled: boolean;
  /** Sprint 1 TASK 3: flips when settlement begins to block duplicate runs. */
  settlementStarted?: boolean;
  resultSaved: boolean;
  /** Sprint 1 TASK 3: flips once player progression has been applied. */
  progressionApplied?: boolean;
  /** Set after tournament bracket row is advanced (idempotency). */
  bracketAdvanced?: boolean;
  timeout?: NodeJS.Timeout;
  isResolving: boolean;
  resolveContinuationTimeout?: NodeJS.Timeout;
  disconnectedPlayerId?: string;
  disconnectedAt?: number;
  disconnectForfeitTimeout?: NodeJS.Timeout;
  /**
   * Wall-clock (ms epoch) when the active disconnect/forfeit grace
   * window expires. Set alongside `disconnectForfeitTimeout` and
   * cleared when grace is resolved. `startRoundTimer` reads this to
   * refuse starting a pick timer while a grace window is still live.
   */
  disconnectForfeitExpiresAt?: number;
  /**
   * Monotonic counter bumped on each `armDisconnectForfeitGrace` call.
   * The forfeit callback captures the generation at arm-time and
   * no-ops if it no longer matches — prevents stale timers from
   * firing after reconnect / re-arm / clearRoomTimer races.
   */
  disconnectForfeitGeneration?: number;
  /**
   * Phase 6C — pre-match return window.
   *
   * Set when both player slots are filled but at least one player
   * is absent from the match page. The readiness authority arms a
   * 10s timeout (`waitingForReturnTimeout`) and a wall-clock
   * deadline (`waitingForReturnUntil`, ms epoch); if presence
   * doesn't recover by then, non-tournament rooms are cancelled
   * cleanly (no score, no forfeit). Tournament rooms ignore this
   * cancellation path — they delegate no-show handling to
   * tournament cleanup.
   */
  waitingForReturnUntil?: number;
  waitingForReturnTimeout?: NodeJS.Timeout;
  /**
   * Phase 6C — server-authoritative staging countdown.
   *
   * After both players are confirmed present, the readiness
   * authority emits `match:stagingBegin` and arms this timeout for
   * `STAGING_COUNTDOWN_MS`. The actual pick timer (`startRoundTimer`)
   * only fires when this expires. Holding the timer back during
   * staging guarantees both clients see the cinematic 3-2-1
   * countdown BEFORE the 10s pick window begins counting.
   *
   * `stagingStartsAt` is the ms-epoch the countdown began so both
   * clients can render a drift-corrected animation against a single
   * server timestamp.
   */
  stagingStartsAt?: number;
  stagingCountdownTimeout?: NodeJS.Timeout;
  /** Sprint 1 TASK 8: room creation timestamp (ms). */
  createdAt: number;
  /** Sprint 1 TASK 8: last meaningful activity (ms) — joins, picks, results. */
  lastActivityAt: number;
  /** Sprint 1 TASK 4: scheduled deletion handle. */
  cleanupTimeout?: NodeJS.Timeout;
  /** Sprint 1 TASK 1: spectator socket ids attached to `${code}:spectators`. */
  spectatorSocketIds: Set<string>;
};

export type PublicMatchOffer = {
  offerId: string;
  roomCode: string;
  hostPlayerId: string;
  hostUsername: string;
  stakeLabel: string;
  stakeAmount: number;
  rounds: number;
  createdAt: number;
  /**
   * Host-disconnect grace window.
   *
   * Set (in ms epoch) when the host's socket drops while the offer is
   * still live and not yet matched. Unset when the host reconnects
   * within the grace window or when the offer is matched/cancelled.
   *
   * Lobby clients use these to render "host reconnecting" affordances
   * and to gate join attempts. The `publicOffer:join` handler rejects
   * any incoming join while `hostDisconnectedAt` is defined, so a
   * guest can never land in a broken room with an absent host.
   */
  hostDisconnectedAt?: number;
  /**
   * Ms epoch deadline at which `hostDisconnectedAt` flips into a
   * hard offer-removal: stake released, room cleaned up, lobby snapshot
   * re-emitted. Used by the server timer and surfaced to clients so
   * the lobby UI can render a deterministic countdown if it wants.
   */
  hostExpiresAt?: number;
};

export type RankedQueueEntry = {
  playerId: string;
  username: string;
  socketId: string;
  enqueuedAt: number;
};
