/**
 * B6D2B — guarded staging harness protocol helpers (STANDALONE, presentation-only).
 *
 * Pure, dependency-free helpers used by the DEV-ONLY `/dev/unity-staging` route to:
 *
 *   - build deterministic MOCK Protocol v1 envelopes to SEND to the Unity iframe
 *     (React → Unity), and
 *   - strictly validate + normalize the sanitized acknowledgements Unity POSTS
 *     back (Unity → React): `presentation_applied` / `presentation_rejected`.
 *
 * Every normalizer builds a NEW object field-by-field with a fixed key set, so
 * raw inbound objects are never stored and any extra/sensitive field (player-id
 * keys, usernames, auth/session/token, socket, wallet/economy) is inherently
 * stripped. All validators are exception-safe: each field is snapshotted once so
 * a hostile getter cannot vary across reads, and any throw yields `null`.
 *
 * This module opens NO sockets, reads NO Supabase/auth/wallet data, and carries
 * NO gameplay authority. It is MOCK-only staging tooling.
 */

// ── Constants ──────────────────────────────────────────────────────────────
export const MATCH_EVENT_TYPE = "PENALTY444_MATCH_EVENT" as const;
export const UNITY_EVENT_TYPE = "PENALTY444_UNITY_EVENT" as const;
export const PROTOCOL_VERSION = 1 as const;

export const MAX_SCORE_ENTRIES = 16;

export type Lane = "LEFT" | "CENTER" | "RIGHT";
export type VisualResult = "GOAL" | "SAVE" | "DRAW";
export type MatchPhase = "NORMAL" | "SUDDEN_DEATH";
export type AppliedEventName = "round_result" | "match_state_sync";

export const REJECT_REASONS = [
  "invalid_envelope",
  "unsupported_version",
  "no_active_instance",
  "stale_or_duplicate",
  "foreign_instance",
  "invalid_instance_transition",
  "apply_failed",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const REJECT_REASON_SET: ReadonlySet<string> = new Set(REJECT_REASONS);

// ── Outbound (React → Unity) versioned envelopes ────────────────────────────
export interface OutboundRoundResultPayload {
  round: number;
  kickerLane: Lane;
  keeperLane: Lane;
  result: VisualResult;
  statusMessage?: string;
}

export interface OutboundStateSyncPayload {
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  phase: MatchPhase;
  suddenDeathRound?: number;
}

export interface OutboundRoundResultEnvelope {
  type: typeof MATCH_EVENT_TYPE;
  protocolVersion: typeof PROTOCOL_VERSION;
  matchInstanceId: string;
  sequence: number;
  event: "round_result";
  payload: OutboundRoundResultPayload;
}

export interface OutboundStateSyncEnvelope {
  type: typeof MATCH_EVENT_TYPE;
  protocolVersion: typeof PROTOCOL_VERSION;
  matchInstanceId: string;
  sequence: number;
  event: "match_state_sync";
  payload: OutboundStateSyncPayload;
}

export type OutboundEnvelope =
  | OutboundRoundResultEnvelope
  | OutboundStateSyncEnvelope;

export function buildStateSyncEnvelope(
  matchInstanceId: string,
  sequence: number,
  payload: OutboundStateSyncPayload,
): OutboundStateSyncEnvelope {
  const p: OutboundStateSyncPayload = {
    scores: { ...payload.scores },
    round: payload.round,
    maxRounds: payload.maxRounds,
    phase: payload.phase,
  };
  if (payload.suddenDeathRound !== undefined) {
    p.suddenDeathRound = payload.suddenDeathRound;
  }
  return {
    type: MATCH_EVENT_TYPE,
    protocolVersion: PROTOCOL_VERSION,
    matchInstanceId,
    sequence,
    event: "match_state_sync",
    payload: p,
  };
}

export function buildRoundResultEnvelope(
  matchInstanceId: string,
  sequence: number,
  payload: OutboundRoundResultPayload,
): OutboundRoundResultEnvelope {
  const p: OutboundRoundResultPayload = {
    round: payload.round,
    kickerLane: payload.kickerLane,
    keeperLane: payload.keeperLane,
    result: payload.result,
  };
  if (payload.statusMessage !== undefined) p.statusMessage = payload.statusMessage;
  return {
    type: MATCH_EVENT_TYPE,
    protocolVersion: PROTOCOL_VERSION,
    matchInstanceId,
    sequence,
    event: "round_result",
    payload: p,
  };
}

// ── Inbound (Unity → React) normalized acknowledgements ─────────────────────
export interface NormalizedAppliedAck {
  event: "presentation_applied";
  protocolVersion: 1;
  matchInstanceId: string;
  sequence: number;
  appliedEvent: AppliedEventName;
  round: number;
  result?: VisualResult;
  phase?: MatchPhase;
  suddenDeathRound?: number;
  scoreValues?: number[];
  playerCount?: number;
}

export interface NormalizedRejectedAck {
  event: "presentation_rejected";
  protocolVersion: 1;
  matchInstanceId?: string;
  sequence?: number;
  rejectedEvent?: AppliedEventName;
  reason: RejectReason;
}

export type NormalizedUnityAck = NormalizedAppliedAck | NormalizedRejectedAck;

// ── Primitive validators (never throw) ──────────────────────────────────────
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const MATCH_INSTANCE_RE = /^[A-Z0-9]+:[1-9][0-9]*$/;

export function isValidMatchInstanceId(value: unknown): value is string {
  return typeof value === "string" && MATCH_INSTANCE_RE.test(value);
}

function isLane(value: unknown): value is Lane {
  return value === "LEFT" || value === "CENTER" || value === "RIGHT";
}

function isVisualResult(value: unknown): value is VisualResult {
  return value === "GOAL" || value === "SAVE" || value === "DRAW";
}

function isMatchPhase(value: unknown): value is MatchPhase {
  return value === "NORMAL" || value === "SUDDEN_DEATH";
}

function isAppliedEventName(value: unknown): value is AppliedEventName {
  return value === "round_result" || value === "match_state_sync";
}

function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === "string" && REJECT_REASON_SET.has(value);
}

/**
 * Accept ONLY an ordinary object (Object.prototype or null prototype). Rejects
 * arrays, class instances, functions, null, and hostile/revoked Proxies (any
 * prototype-inspection throw is treated as "not a plain record").
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null) return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

/** Validate a numeric-only score-values array (non-negative ints, bounded). */
function validateScoreValues(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > MAX_SCORE_ENTRIES) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (!isNonNegativeInteger(v)) return null;
    out.push(v);
  }
  return out;
}

// ── Ack validation + normalization ──────────────────────────────────────────
/**
 * Strictly validate + normalize a raw inbound Unity → React acknowledgement.
 * Returns a NEW normalized object (fixed key set) or `null`. Never throws and
 * never retains a reference to the raw input. `ready`/`error` lifecycle events
 * are NOT handled here (the client keeps its existing strict listener for those).
 */
export function validateUnityAck(raw: unknown): NormalizedUnityAck | null {
  try {
    if (!isPlainRecord(raw)) return null;

    // Snapshot each top-level field ONCE.
    const type = raw.type;
    const event = raw.event;
    const payload = raw.payload;

    if (type !== UNITY_EVENT_TYPE) return null;
    if (!isPlainRecord(payload)) return null;

    if (event === "presentation_applied") {
      return normalizeApplied(payload);
    }
    if (event === "presentation_rejected") {
      return normalizeRejected(payload);
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeApplied(payload: Record<string, unknown>): NormalizedAppliedAck | null {
  // Snapshot each field ONCE.
  const protocolVersion = payload.protocolVersion;
  const matchInstanceId = payload.matchInstanceId;
  const sequence = payload.sequence;
  const appliedEvent = payload.appliedEvent;
  const round = payload.round;
  const result = payload.result;
  const phase = payload.phase;
  const suddenDeathRound = payload.suddenDeathRound;
  const scoreValues = payload.scoreValues;
  const playerCount = payload.playerCount;

  if (protocolVersion !== PROTOCOL_VERSION) return null;
  if (!isValidMatchInstanceId(matchInstanceId)) return null;
  if (!isPositiveInteger(sequence)) return null;
  if (!isAppliedEventName(appliedEvent)) return null;
  if (!isPositiveInteger(round)) return null;

  if (appliedEvent === "round_result") {
    if (!isVisualResult(result)) return null;
    // A result ack must NOT carry a score.
    if (scoreValues !== undefined || playerCount !== undefined) return null;
    return {
      event: "presentation_applied",
      protocolVersion: PROTOCOL_VERSION,
      matchInstanceId,
      sequence,
      appliedEvent,
      round,
      result,
    };
  }

  // match_state_sync
  if (!isMatchPhase(phase)) return null;
  const values = validateScoreValues(scoreValues);
  if (values === null) return null;
  if (!isPositiveInteger(playerCount)) return null;
  if (playerCount !== values.length) return null;

  const normalized: NormalizedAppliedAck = {
    event: "presentation_applied",
    protocolVersion: PROTOCOL_VERSION,
    matchInstanceId,
    sequence,
    appliedEvent,
    round,
    phase,
    scoreValues: values,
    playerCount,
  };
  if (phase === "SUDDEN_DEATH" && suddenDeathRound !== undefined) {
    if (!isNonNegativeInteger(suddenDeathRound)) return null;
    normalized.suddenDeathRound = suddenDeathRound;
  }
  return normalized;
}

function normalizeRejected(payload: Record<string, unknown>): NormalizedRejectedAck | null {
  const protocolVersion = payload.protocolVersion;
  const matchInstanceId = payload.matchInstanceId;
  const sequence = payload.sequence;
  const rejectedEvent = payload.rejectedEvent;
  const reason = payload.reason;

  if (protocolVersion !== PROTOCOL_VERSION) return null;
  if (!isRejectReason(reason)) return null;

  const normalized: NormalizedRejectedAck = {
    event: "presentation_rejected",
    protocolVersion: PROTOCOL_VERSION,
    reason,
  };
  // Optional echoed fields — included only when individually valid.
  if (matchInstanceId !== undefined) {
    if (!isValidMatchInstanceId(matchInstanceId)) return null;
    normalized.matchInstanceId = matchInstanceId;
  }
  if (sequence !== undefined) {
    if (!isPositiveInteger(sequence)) return null;
    normalized.sequence = sequence;
  }
  if (rejectedEvent !== undefined) {
    if (!isAppliedEventName(rejectedEvent)) return null;
    normalized.rejectedEvent = rejectedEvent;
  }
  return normalized;
}

// ── Deterministic Protocol v1 proof plan (§11) ──────────────────────────────
export type ProofExpectation =
  | { kind: "ready" }
  | {
      kind: "applied";
      appliedEvent: AppliedEventName;
      sequence: number;
      matchInstanceId: string;
      result?: VisualResult;
      phase?: MatchPhase;
      scoreValues?: number[];
    }
  | {
      kind: "rejected";
      reason: RejectReason;
      sequence?: number;
    };

export interface ProofStep {
  id: number;
  label: string;
  action: "await-ready" | "send" | "reload";
  outbound?: OutboundEnvelope;
  expect: ProofExpectation;
}

const INSTANCE_1 = "ABCD12:1";
const INSTANCE_2 = "ABCD12:2";

/**
 * Build the deterministic 16-step Protocol v1 proof plan. Pure data so ordering
 * and content are unit-testable. The client executes each step against the
 * iframe, matching received acks to `expect`.
 */
export function buildProtocolV1ProofPlan(): ProofStep[] {
  return [
    {
      id: 1,
      label: "Unity ready received",
      action: "await-ready",
      expect: { kind: "ready" },
    },
    {
      id: 2,
      label: "state sync instance 1, seq 1: scores 0/0, round 1, NORMAL",
      action: "send",
      outbound: buildStateSyncEnvelope(INSTANCE_1, 1, {
        scores: { p1: 0, p2: 0 },
        round: 1,
        maxRounds: 5,
        phase: "NORMAL",
      }),
      expect: {
        kind: "applied",
        appliedEvent: "match_state_sync",
        sequence: 1,
        matchInstanceId: INSTANCE_1,
        phase: "NORMAL",
        scoreValues: [0, 0],
      },
    },
    {
      id: 3,
      label: "round_result seq 2, GOAL (does not increment scoreboard)",
      action: "send",
      outbound: buildRoundResultEnvelope(INSTANCE_1, 2, {
        round: 1,
        kickerLane: "LEFT",
        keeperLane: "RIGHT",
        result: "GOAL",
      }),
      expect: {
        kind: "applied",
        appliedEvent: "round_result",
        sequence: 2,
        matchInstanceId: INSTANCE_1,
        result: "GOAL",
      },
    },
    {
      id: 4,
      label: "authoritative state sync seq 3: scores 1/0, round 2",
      action: "send",
      outbound: buildStateSyncEnvelope(INSTANCE_1, 3, {
        scores: { p1: 1, p2: 0 },
        round: 2,
        maxRounds: 5,
        phase: "NORMAL",
      }),
      expect: {
        kind: "applied",
        appliedEvent: "match_state_sync",
        sequence: 3,
        matchInstanceId: INSTANCE_1,
        phase: "NORMAL",
        scoreValues: [1, 0],
      },
    },
    {
      id: 5,
      label: "duplicate seq 3 rejected (stale_or_duplicate)",
      action: "send",
      outbound: buildStateSyncEnvelope(INSTANCE_1, 3, {
        scores: { p1: 1, p2: 0 },
        round: 2,
        maxRounds: 5,
        phase: "NORMAL",
      }),
      expect: { kind: "rejected", reason: "stale_or_duplicate", sequence: 3 },
    },
    {
      id: 6,
      label: "stale seq 2 rejected (stale_or_duplicate)",
      action: "send",
      outbound: buildStateSyncEnvelope(INSTANCE_1, 2, {
        scores: { p1: 1, p2: 0 },
        round: 2,
        maxRounds: 5,
        phase: "NORMAL",
      }),
      expect: { kind: "rejected", reason: "stale_or_duplicate", sequence: 2 },
    },
    {
      id: 7,
      label: "new instance 2 state seq 1 applied (resets + applies)",
      action: "send",
      outbound: buildStateSyncEnvelope(INSTANCE_2, 1, {
        scores: { p1: 0, p2: 0 },
        round: 1,
        maxRounds: 5,
        phase: "NORMAL",
      }),
      expect: {
        kind: "applied",
        appliedEvent: "match_state_sync",
        sequence: 1,
        matchInstanceId: INSTANCE_2,
        phase: "NORMAL",
        scoreValues: [0, 0],
      },
    },
    {
      id: 8,
      label: "old-instance result rejected (foreign_instance)",
      action: "send",
      outbound: buildRoundResultEnvelope(INSTANCE_1, 4, {
        round: 2,
        kickerLane: "CENTER",
        keeperLane: "CENTER",
        result: "SAVE",
      }),
      expect: { kind: "rejected", reason: "foreign_instance", sequence: 4 },
    },
    {
      id: 9,
      label: "SUDDEN_DEATH state applied exactly (seq 2)",
      action: "send",
      outbound: buildStateSyncEnvelope(INSTANCE_2, 2, {
        scores: { p1: 5, p2: 5 },
        round: 6,
        maxRounds: 5,
        phase: "SUDDEN_DEATH",
        suddenDeathRound: 1,
      }),
      expect: {
        kind: "applied",
        appliedEvent: "match_state_sync",
        sequence: 2,
        matchInstanceId: INSTANCE_2,
        phase: "SUDDEN_DEATH",
        scoreValues: [5, 5],
      },
    },
    {
      id: 10,
      label: "iframe reload → new ready lifecycle",
      action: "reload",
      expect: { kind: "ready" },
    },
    {
      id: 11,
      label: "post-reload bootstrap: state seq 3 (>1) accepted as fresh",
      action: "send",
      outbound: buildStateSyncEnvelope(INSTANCE_2, 3, {
        scores: { p1: 6, p2: 5 },
        round: 7,
        maxRounds: 5,
        phase: "SUDDEN_DEATH",
        suddenDeathRound: 2,
      }),
      expect: {
        kind: "applied",
        appliedEvent: "match_state_sync",
        sequence: 3,
        matchInstanceId: INSTANCE_2,
        phase: "SUDDEN_DEATH",
        scoreValues: [6, 5],
      },
    },
  ];
}
