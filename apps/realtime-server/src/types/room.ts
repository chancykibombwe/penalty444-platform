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
   * Match-page presence. True only between an explicit `room:join` (when
   * the player's `MatchRoomPanel` mounts) and `room:leave` (unmount) /
   * socket disconnect.
   *
   * This is intentionally NOT the same as "has a live socket". A player
   * can be on `/lobby` with a healthy socket — they're connected, but
   * NOT on the match page, so `present` is `false` and the round timer
   * MUST NOT start against them. The pre-match `evaluateMatchStart`
   * gate uses this field to delay `startRoundTimer` until every slot
   * is filled AND every player has confirmed presence.
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
   * Pre-match fairness window. When both player slots are filled but
   * at least one player has `present === false`, the server stops the
   * round timer from starting and instead arms a short return window.
   * `waitingForReturnUntil` is the ms-epoch deadline by which the
   * absent player must `room:join` again, and `waitingForReturnTimeout`
   * is the server-side timer that fires `match:cancelled` (for
   * non-tournament rooms) or simply ends the wait (tournament rooms,
   * which delegate no-show handling to tournament cleanup).
   *
   * Both fields are cleared as soon as everyone is present OR the
   * room is cancelled — see `clearWaitingForReturn` in
   * `room/lifecycle.ts`.
   */
  waitingForReturnUntil?: number;
  waitingForReturnTimeout?: NodeJS.Timeout;
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
};

export type RankedQueueEntry = {
  playerId: string;
  username: string;
  socketId: string;
  enqueuedAt: number;
};
