export type Lane = "LEFT" | "CENTER" | "RIGHT";
export type Role = "KICKER" | "KEEPER";
export type ShotResult = "GOAL" | "SAVE" | "DRAW";
export type MatchType = "private" | "public" | "ranked" | "tournament" | "unknown";
export type MatchPhase = "NORMAL" | "SUDDEN_DEATH";

export type RoomPlayer = {
  playerId: string;
  socketId: string;
  username: string;
};

export type Room = {
  code: string;
  /** Increments when a rematch starts in the same room; pairs with room_code for saved rows. */
  matchInstance: number;
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
  resultSaved: boolean;
  /** Set after tournament bracket row is advanced (idempotency). */
  bracketAdvanced?: boolean;
  timeout?: NodeJS.Timeout;
  isResolving: boolean;
  resolveContinuationTimeout?: NodeJS.Timeout;
  disconnectedPlayerId?: string;
  disconnectedAt?: number;
  disconnectForfeitTimeout?: NodeJS.Timeout;
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
