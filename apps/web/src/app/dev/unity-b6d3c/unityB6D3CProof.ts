/**
 * B6D3C — protected-preview MOCK proof plan (PURE; proof-only).
 *
 * Deterministic machinery for the isolated B6D3C runtime proof. This module is
 * pure TypeScript: no React, no browser globals, no network, no timers, no
 * environment reads, no Socket.IO, no Supabase. It builds the proof plan, drives
 * the merged sanitization adapter, and produces SANITIZED evidence only.
 *
 * All gameplay data is synthetic. `MOCK_VIEWER_ID` / `MOCK_OPPONENT_ID` are test
 * identifiers, never real accounts. They appear ONLY on the raw input side; they
 * must never reach a projected message, host prop, evidence row, diagnostic or
 * report — `assertNoProhibitedValues` enforces that before any report is emitted.
 *
 * Protocol v1 is NOT redeclared here: envelopes are validated with the merged
 * `validateEnvelope`, projected with the merged viewer-presentation adapter, and
 * acknowledgements are normalized with the merged strict staging-ack validator.
 *
 * Building this plan executes NOTHING. The protected-preview proof itself requires
 * separate authorization; see docs/unity-b6d3c-protected-preview-proof.md.
 */

import {
  validateEnvelope,
  PRESENTATION_TYPE,
  PRESENTATION_PROTOCOL_VERSION,
  type PresentationEnvelope,
} from "../../../components/match/unityPresentationProtocol";
import {
  buildViewerPresentation,
  type ViewerPresentationMessage,
} from "../../../components/match/useViewerPresentation";
import type { ViewerIdentityContext } from "../../../components/match/unityPresentationIdentity";
import {
  validateUnityAck,
  REJECT_REASONS,
  type NormalizedUnityAck,
  type RejectReason,
} from "../unity-staging/unityStagingProtocol";

// ── Synthetic identifiers and instances ───────────────────────────────────────

/** Synthetic proof identity. NOT a real account id. Raw-input side only. */
export const MOCK_VIEWER_ID = "b6d3c-mock-viewer-0000-0000-000000000001" as const;
/** Synthetic proof opponent. NOT a real account id. Raw-input side only. */
export const MOCK_OPPONENT_ID = "b6d3c-mock-oppon-0000-0000-000000000002" as const;

export const PROOF_INSTANCE_A = "B6D3C01:1" as const;
export const PROOF_INSTANCE_B = "B6D3C01:2" as const;
/** A different room entirely — used for the foreign-instance negative case. */
export const PROOF_FOREIGN_INSTANCE = "B6D3C99:1" as const;

/** The exact protected entry the later proof must load. Never request-derived. */
export const REQUIRED_BUILD_URL = "/unity-arena/player" as const;

/** Every raw synthetic value that must never escape into evidence. */
export const PROHIBITED_VALUES: ReadonlyArray<string> = Object.freeze([
  MOCK_VIEWER_ID,
  MOCK_OPPONENT_ID,
]);

/** Field names that must never appear in any retained evidence. */
export const PROHIBITED_EVIDENCE_KEYS: ReadonlyArray<string> = Object.freeze([
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "cookie",
  "authorization",
  "email",
  "userId",
  "sub",
  "secret",
  "wallet",
  "balance",
  "socket",
  "roomCode",
  "matchId",
  "raw",
  "rawData",
  "payloadJson",
]);

// ── Gates and steps ───────────────────────────────────────────────────────────

export type ProofGateId =
  | "A_BOOTSTRAP"
  | "B_RESULT_STATE_SEPARATION"
  | "C_PER_ENVELOPE_SCORES"
  | "D_DUPLICATE_STALE"
  | "E_FOREIGN_INSTANCE"
  | "F_INSTANCE_TRANSITION"
  | "G_SUDDEN_DEATH"
  | "H_RELOAD_BOOTSTRAP"
  | "I_FAIL_OPEN"
  | "J_SANITIZATION";

export const PROOF_GATE_IDS: ReadonlyArray<ProofGateId> = Object.freeze([
  "A_BOOTSTRAP",
  "B_RESULT_STATE_SEPARATION",
  "C_PER_ENVELOPE_SCORES",
  "D_DUPLICATE_STALE",
  "E_FOREIGN_INSTANCE",
  "F_INSTANCE_TRANSITION",
  "G_SUDDEN_DEATH",
  "H_RELOAD_BOOTSTRAP",
  "I_FAIL_OPEN",
  "J_SANITIZATION",
]);

/**
 * How a step reaches Unity.
 *  - `host`            — through the real UnityPresentationHost / MatchRenderer3D
 *                        FIFO path. ALL positive lifecycle/ordering evidence.
 *  - `direct-negative` — proof-only injection of an already-sanitized envelope
 *                        straight to the single proof iframe, used ONLY for
 *                        duplicate / stale / foreign-instance negatives that the
 *                        host path deliberately filters out before Unity.
 *  - `harness`         — a local observation (reload, induced error, DOM count).
 */
export type ProofChannel = "host" | "direct-negative" | "harness";

export type ProofAction = "send" | "reload" | "induce-error" | "observe";

/** Safe, bounded failure categories. Arbitrary error text is never retained. */
export type SafeFailureCategory =
  | "none"
  | "timeout"
  | "unexpected_outcome"
  | "unexpected_rejection"
  | "missing_acknowledgement"
  | "missing_send_confirmation"
  | "iframe_invariant_violation"
  | "sanitization_violation"
  | "network_violation"
  | "network_observation_unavailable"
  | "gate_denied"
  | "harness_error";

export const SAFE_FAILURE_CATEGORIES: ReadonlyArray<SafeFailureCategory> = Object.freeze([
  "none",
  "timeout",
  "unexpected_outcome",
  "unexpected_rejection",
  "missing_acknowledgement",
  "missing_send_confirmation",
  "iframe_invariant_violation",
  "sanitization_violation",
  "network_violation",
  "network_observation_unavailable",
  "gate_denied",
  "harness_error",
]);

/** Rejection reasons are constrained to the merged, already-audited allowlist. */
export const SAFE_REJECT_REASONS: ReadonlyArray<RejectReason> = Object.freeze([...REJECT_REASONS]);

export function isSafeRejectReason(value: unknown): value is RejectReason {
  return typeof value === "string" && (SAFE_REJECT_REASONS as readonly string[]).includes(value);
}

export type ProofExpectation =
  | {
      readonly kind: "applied";
      readonly event: "round_result" | "match_state_sync";
      readonly sequence: number;
      readonly matchInstanceId: string;
      readonly result?: "GOAL" | "SAVE" | "DRAW";
      readonly phase?: "NORMAL" | "SUDDEN_DEATH";
      readonly scoreValues?: ReadonlyArray<number>;
      /**
       * B6D3C-only expectation. The MERGED acknowledgement normalizer already
       * preserves `suddenDeathRound` for a SUDDEN_DEATH state sync; this field
       * simply asserts the exact value reached Unity and came back unchanged.
       * The normalizer itself is NOT modified.
       */
      readonly suddenDeathRound?: number;
    }
  | { readonly kind: "rejected"; readonly reason: RejectReason; readonly sequence?: number }
  | { readonly kind: "ready" }
  | { readonly kind: "not-delivered" }
  | { readonly kind: "host-state"; readonly hostState: string; readonly iframeCount: number };

export interface ProofStep {
  readonly step: number;
  readonly gate: ProofGateId;
  readonly label: string;
  readonly channel: ProofChannel;
  readonly action: ProofAction;
  /** Safe bounded timeout label — never a raw duration from user input. */
  readonly timeoutLabel: "short" | "standard" | "load";
  readonly expect: ProofExpectation;
}

// ── Raw synthetic inputs (raw-id side only) ───────────────────────────────────

export interface RawStateSyncSpec {
  readonly matchInstanceId: string;
  readonly sequence: number;
  readonly selfScore: number;
  readonly opponentScore: number;
  readonly round: number;
  readonly maxRounds: number;
  readonly phase: "NORMAL" | "SUDDEN_DEATH";
  readonly suddenDeathRound?: number;
}

export interface RawRoundResultSpec {
  readonly matchInstanceId: string;
  readonly sequence: number;
  readonly round: number;
  readonly kickerLane: "LEFT" | "CENTER" | "RIGHT";
  readonly keeperLane: "LEFT" | "CENTER" | "RIGHT";
  readonly result: "GOAL" | "SAVE" | "DRAW";
}

/** Build a RAW, id-keyed `match_state_sync` exactly as the shadow path produces. */
export function buildRawStateSync(spec: RawStateSyncSpec): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    scores: { [MOCK_VIEWER_ID]: spec.selfScore, [MOCK_OPPONENT_ID]: spec.opponentScore },
    round: spec.round,
    maxRounds: spec.maxRounds,
    phase: spec.phase,
  };
  if (spec.suddenDeathRound !== undefined) payload.suddenDeathRound = spec.suddenDeathRound;
  return {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId: spec.matchInstanceId,
    sequence: spec.sequence,
    event: "match_state_sync",
    payload,
  };
}

/** Build a RAW `round_result`. It carries no score map and derives nothing. */
export function buildRawRoundResult(spec: RawRoundResultSpec): Record<string, unknown> {
  return {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId: spec.matchInstanceId,
    sequence: spec.sequence,
    event: "round_result",
    payload: {
      round: spec.round,
      kickerLane: spec.kickerLane,
      keeperLane: spec.keeperLane,
      result: spec.result,
    },
  };
}

export interface RawProofInput {
  readonly id: string;
  readonly message: Record<string, unknown>;
}

/**
 * The deterministic raw mock feed for the HOST path (instance A then B). Ids are
 * derived from instance/sequence/event only — never from a player id.
 */
export function buildRawHostInputs(matchInstanceId: string): ReadonlyArray<RawProofInput> {
  const id = (seq: number, event: string) => `${matchInstanceId}:${seq}:${event}`;
  if (matchInstanceId === PROOF_INSTANCE_A) {
    return Object.freeze([
      // A — bootstrap 0/0
      {
        id: id(1, "match_state_sync"),
        message: buildRawStateSync({
          matchInstanceId,
          sequence: 1,
          selfScore: 0,
          opponentScore: 0,
          round: 1,
          maxRounds: 5,
          phase: "NORMAL",
        }),
      },
      // B — result carries NO score…
      {
        id: id(2, "round_result"),
        message: buildRawRoundResult({
          matchInstanceId,
          sequence: 2,
          round: 1,
          kickerLane: "LEFT",
          keeperLane: "RIGHT",
          result: "GOAL",
        }),
      },
      // …the authoritative score change arrives only on the following sync.
      // C — this and the bootstrap above are two distinct snapshots.
      {
        id: id(3, "match_state_sync"),
        message: buildRawStateSync({
          matchInstanceId,
          sequence: 3,
          selfScore: 1,
          opponentScore: 0,
          round: 2,
          maxRounds: 5,
          phase: "NORMAL",
        }),
      },
      // G — sudden death, values supplied explicitly.
      {
        id: id(4, "match_state_sync"),
        message: buildRawStateSync({
          matchInstanceId,
          sequence: 4,
          selfScore: 3,
          opponentScore: 3,
          round: 6,
          maxRounds: 5,
          phase: "SUDDEN_DEATH",
          suddenDeathRound: 1,
        }),
      },
    ]);
  }
  // F — instance transition: a fresh complete bootstrap at sequence 1.
  return Object.freeze([
    {
      id: id(1, "match_state_sync"),
      message: buildRawStateSync({
        matchInstanceId,
        sequence: 1,
        selfScore: 0,
        opponentScore: 0,
        round: 1,
        maxRounds: 5,
        phase: "NORMAL",
      }),
    },
    // H — post-reload bootstrap with a sequence greater than 1.
    {
      id: id(5, "match_state_sync"),
      message: buildRawStateSync({
        matchInstanceId,
        sequence: 5,
        selfScore: 2,
        opponentScore: 1,
        round: 3,
        maxRounds: 5,
        phase: "NORMAL",
      }),
    },
  ]);
}

// ── Projection through the merged adapter ─────────────────────────────────────

export interface ProjectedProofFeed {
  readonly messages: ReadonlyArray<ViewerPresentationMessage>;
  /** Sanitized viewer identity produced by the merged adapter (LEFT/RIGHT only). */
  readonly identity: ViewerIdentityContext | null;
  readonly identityPresent: boolean;
}

/**
 * Project raw inputs through the MERGED viewer-presentation adapter. Scores become
 * LEFT/RIGHT per envelope, and no raw id survives. Nothing here re-implements the
 * projection — the production adapter is the single source of truth.
 */
export function projectProofFeed(
  matchInstanceId: string,
  rawInputs: ReadonlyArray<RawProofInput>,
  liveSelfScore = 0,
  liveOpponentScore = 0,
): ProjectedProofFeed {
  const projected = buildViewerPresentation({
    matchInstanceId,
    viewerPlayerId: MOCK_VIEWER_ID,
    // Live outer scores exist only to establish identity/host activation. Each
    // envelope keeps its OWN snapshot (verified by gate C).
    scores: { [MOCK_VIEWER_ID]: liveSelfScore, [MOCK_OPPONENT_ID]: liveOpponentScore },
    pending: rawInputs.map((r) => ({ id: r.id, message: r.message })),
  });
  return {
    messages: projected.messages,
    identity: projected.identity,
    identityPresent: projected.identity !== null,
  };
}

/** Direct-negative envelopes: already sanitized, LEFT/RIGHT keyed, no raw ids. */
export function buildSanitizedNegativeEnvelope(args: {
  matchInstanceId: string;
  sequence: number;
  leftScore: number;
  rightScore: number;
  round: number;
  maxRounds: number;
  phase: "NORMAL" | "SUDDEN_DEATH";
}): PresentationEnvelope | null {
  const candidate = {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId: args.matchInstanceId,
    sequence: args.sequence,
    event: "match_state_sync",
    payload: {
      scores: { LEFT: args.leftScore, RIGHT: args.rightScore },
      round: args.round,
      maxRounds: args.maxRounds,
      phase: args.phase,
    },
  };
  return validateEnvelope(candidate);
}

// ── Sanitization guards ───────────────────────────────────────────────────────

/** True when the serialized value contains any synthetic raw id. */
export function containsProhibitedValue(serialized: string): boolean {
  return PROHIBITED_VALUES.some((v) => serialized.includes(v));
}

/** True when the serialized value contains a prohibited evidence field name. */
export function containsProhibitedKey(serialized: string): boolean {
  return PROHIBITED_EVIDENCE_KEYS.some((k) => serialized.includes(`"${k}"`));
}

/**
 * Final safety net: throws when anything prohibited would be emitted. Called
 * before any report or evidence set leaves the harness.
 */
export function assertNoProhibitedValues(value: unknown): void {
  const serialized = JSON.stringify(value ?? null);
  if (containsProhibitedValue(serialized)) {
    throw new Error("B6D3C sanitization violation: synthetic raw identifier in output");
  }
  if (containsProhibitedKey(serialized)) {
    throw new Error("B6D3C sanitization violation: prohibited field in output");
  }
}

/** Verify every projected message is free of synthetic raw ids. */
export function projectedFeedIsSanitized(feed: ProjectedProofFeed): boolean {
  return !containsProhibitedValue(JSON.stringify(feed.messages));
}

// ── Evidence ──────────────────────────────────────────────────────────────────

export type ProofStatus = "pass" | "fail" | "pending";

/**
 * Fixed-field observation of the fail-open contract. Booleans only — no free
 * text, no identity, no DOM content. Every field must be true for gate I.
 */
export interface FallbackObservation {
  readonly hostTerminal: boolean;
  readonly iframeCountZero: boolean;
  readonly unityUnderlayPresent: boolean;
  readonly proofUnderlayPresent: boolean;
  readonly underlayVisible: boolean;
  readonly unitySlotAbsent: boolean;
  readonly noUnavailableCard: boolean;
  readonly stableNoRemount: boolean;
  readonly instanceStillTerminal: boolean;
}

export const FALLBACK_OBSERVATION_KEYS: ReadonlyArray<keyof FallbackObservation> = Object.freeze([
  "hostTerminal",
  "iframeCountZero",
  "unityUnderlayPresent",
  "proofUnderlayPresent",
  "underlayVisible",
  "unitySlotAbsent",
  "noUnavailableCard",
  "stableNoRemount",
  "instanceStillTerminal",
]);

/**
 * Fail-open passes ONLY when every field holds. Host state and iframe count
 * alone are deliberately insufficient: a terminal host that had unmounted the
 * React underlay, left the renderer's "unavailable" card behind, or silently
 * remounted an iframe would still be a broken fallback.
 */
export function fallbackObservationPassed(observation: FallbackObservation): boolean {
  return FALLBACK_OBSERVATION_KEYS.every((key) => observation[key] === true);
}

/** A single sanitized evidence row. No raw JSON, no identity, no free text. */
export interface ProofEvidenceRow {
  readonly step: number;
  readonly gate: ProofGateId;
  readonly direction: "react-to-unity" | "unity-to-react" | "harness";
  readonly event: string | null;
  readonly protocolVersion: number | null;
  readonly matchInstanceId: string | null;
  readonly sequence: number | null;
  readonly result: string | null;
  readonly phase: string | null;
  readonly scoreValues: ReadonlyArray<number> | null;
  readonly suddenDeathRound: number | null;
  readonly playerCount: number | null;
  readonly appliedEvent: string | null;
  readonly rejectionReason: RejectReason | null;
  readonly hostState: string | null;
  readonly iframeCount: number | null;
  readonly fallback: FallbackObservation | null;
  readonly status: ProofStatus;
  readonly failureCategory: SafeFailureCategory;
}

const EMPTY_ROW = {
  event: null,
  protocolVersion: null,
  matchInstanceId: null,
  sequence: null,
  result: null,
  phase: null,
  scoreValues: null,
  suddenDeathRound: null,
  playerCount: null,
  appliedEvent: null,
  rejectionReason: null,
  hostState: null,
  iframeCount: null,
  fallback: null,
} as const;

/** Build a sanitized evidence row from a NORMALIZED acknowledgement. */
export function buildEvidenceRowFromAck(
  step: ProofStep,
  ack: NormalizedUnityAck,
  status: ProofStatus,
  failureCategory: SafeFailureCategory = "none",
): ProofEvidenceRow {
  const base = {
    ...EMPTY_ROW,
    step: step.step,
    gate: step.gate,
    direction: "unity-to-react" as const,
    status,
    failureCategory,
  };
  if (ack.event === "presentation_applied") {
    return {
      ...base,
      event: ack.event,
      protocolVersion: ack.protocolVersion,
      matchInstanceId: ack.matchInstanceId,
      sequence: ack.sequence,
      appliedEvent: ack.appliedEvent,
      result: ack.result ?? null,
      phase: ack.phase ?? null,
      scoreValues: ack.scoreValues ? [...ack.scoreValues] : null,
      suddenDeathRound: ack.suddenDeathRound ?? null,
      playerCount: ack.playerCount ?? null,
    };
  }
  return {
    ...base,
    event: ack.event,
    protocolVersion: ack.protocolVersion,
    matchInstanceId: ack.matchInstanceId ?? null,
    sequence: ack.sequence ?? null,
    appliedEvent: ack.rejectedEvent ?? null,
    rejectionReason: isSafeRejectReason(ack.reason) ? ack.reason : null,
  };
}

/** Build a sanitized evidence row for a harness observation. */
export function buildHarnessEvidenceRow(args: {
  step: ProofStep;
  status: ProofStatus;
  hostState?: string | null;
  iframeCount?: number | null;
  fallback?: FallbackObservation | null;
  failureCategory?: SafeFailureCategory;
}): ProofEvidenceRow {
  return {
    ...EMPTY_ROW,
    step: args.step.step,
    gate: args.step.gate,
    direction: "harness",
    hostState: args.hostState ?? null,
    iframeCount: args.iframeCount ?? null,
    fallback: args.fallback ?? null,
    status: args.status,
    failureCategory: args.failureCategory ?? "none",
  };
}

/**
 * Build the gate-I evidence row from a complete fail-open observation. The row
 * passes only when EVERY boolean holds — see `fallbackObservationPassed`.
 */
export function buildFallbackEvidenceRow(
  step: ProofStep,
  observation: FallbackObservation,
  hostState: string | null,
  iframeCount: number | null,
): ProofEvidenceRow {
  const passed = fallbackObservationPassed(observation);
  return buildHarnessEvidenceRow({
    step,
    status: passed ? "pass" : "fail",
    hostState,
    iframeCount,
    fallback: observation,
    failureCategory: passed ? "none" : "unexpected_outcome",
  });
}

/**
 * Build a sanitized evidence row for an outbound (React → Unity) dispatch.
 *
 * The default is `pass` because an outbound row is only ever RETAINED after the
 * dispatch has been confirmed — by the merged host's `onMessageSent` summary for
 * a host dispatch, and by the expected acknowledgement in both channels. A
 * `pending` outbound row must never reach the final evidence collection; the
 * harness may show a transient pending indicator in the UI, but it is not stored.
 */
export function buildOutboundEvidenceRow(
  step: ProofStep,
  envelope: PresentationEnvelope,
  status: ProofStatus = "pass",
): ProofEvidenceRow {
  const scoreValues =
    envelope.event === "match_state_sync"
      ? Object.values(envelope.payload.scores)
          .filter((v): v is number => typeof v === "number")
          .slice()
          .sort((a, b) => a - b)
      : null;
  return {
    ...EMPTY_ROW,
    step: step.step,
    gate: step.gate,
    direction: "react-to-unity",
    event: envelope.event,
    protocolVersion: envelope.protocolVersion,
    matchInstanceId: envelope.matchInstanceId,
    sequence: envelope.sequence,
    result: envelope.event === "round_result" ? envelope.payload.result : null,
    phase: envelope.event === "match_state_sync" ? envelope.payload.phase : null,
    scoreValues,
    suddenDeathRound:
      envelope.event === "match_state_sync" ? envelope.payload.suddenDeathRound ?? null : null,
    playerCount: scoreValues ? scoreValues.length : null,
    status,
    failureCategory: "none",
  };
}

// ── Send confirmation (the merged host's `onMessageSent` summary) ─────────────

/**
 * The sanitized subset of the merged `SentSummary` this harness retains. The
 * message id is deliberately DROPPED: instance + sequence + event identifies the
 * dispatch uniquely in this deterministic plan and carries strictly less data.
 */
export interface SentSummarySnapshot {
  readonly event: string;
  readonly matchInstanceId: string | null;
  readonly sequence: number | null;
}

/** Normalize a raw `SentSummary` into the bounded snapshot. Never throws. */
export function normalizeSentSummary(raw: unknown): SentSummarySnapshot | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const event = record.event;
  if (typeof event !== "string" || event.length === 0) return null;
  const matchInstanceId = record.matchInstanceId;
  const sequence = record.sequence;
  return {
    event,
    matchInstanceId: typeof matchInstanceId === "string" ? matchInstanceId : null,
    sequence: typeof sequence === "number" && Number.isSafeInteger(sequence) ? sequence : null,
  };
}

/** Does a send confirmation correspond to exactly this envelope? */
export function sentSummaryMatches(
  envelope: PresentationEnvelope,
  snapshot: SentSummarySnapshot,
): boolean {
  return (
    snapshot.event === envelope.event &&
    snapshot.matchInstanceId === envelope.matchInstanceId &&
    snapshot.sequence === envelope.sequence
  );
}

// ── Gate C: per-envelope score snapshots, verified at RUNTIME ─────────────────

export interface SnapshotExpectation {
  readonly matchInstanceId: string;
  readonly sequence: number;
  readonly scoreValues: ReadonlyArray<number>;
}

/**
 * The two authoritative snapshots gate C must observe COMING BACK FROM UNITY.
 * The bootstrap must still report 0/0 even though a later envelope (and the
 * live outer React scores) have already moved on — this is the exact defect
 * found during PR-2 review, so it is re-checked against the compiled consumer.
 */
export const GATE_C_SNAPSHOTS: ReadonlyArray<SnapshotExpectation> = Object.freeze([
  Object.freeze({
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 1,
    scoreValues: Object.freeze([0, 0]) as ReadonlyArray<number>,
  }),
  Object.freeze({
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 3,
    scoreValues: Object.freeze([0, 1]) as ReadonlyArray<number>,
  }),
]);

function sameMultiset(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => value === right[index]);
}

/**
 * Locate the applied acknowledgement for one snapshot. Requires an applied ack
 * for `match_state_sync` at the exact instance and sequence.
 */
export function findSnapshotAck(
  acks: ReadonlyArray<NormalizedUnityAck>,
  snapshot: SnapshotExpectation,
): NormalizedUnityAck | null {
  for (const ack of acks) {
    if (ack.event !== "presentation_applied") continue;
    if (ack.appliedEvent !== "match_state_sync") continue;
    if (ack.matchInstanceId !== snapshot.matchInstanceId) continue;
    if (ack.sequence !== snapshot.sequence) continue;
    return ack;
  }
  return null;
}

export interface SnapshotCheck {
  readonly matchInstanceId: string;
  readonly sequence: number;
  readonly found: boolean;
  readonly scoresMatch: boolean;
}

export interface PerEnvelopeSnapshotResult {
  readonly checks: ReadonlyArray<SnapshotCheck>;
  readonly passed: boolean;
}

/**
 * Gate C is proven from the NORMALIZED ACKNOWLEDGEMENTS Unity actually returned,
 * never from host visibility. Score values are compared as multisets because the
 * compiled consumer makes no ordering guarantee.
 */
export function verifyPerEnvelopeSnapshots(
  acks: ReadonlyArray<NormalizedUnityAck>,
  snapshots: ReadonlyArray<SnapshotExpectation> = GATE_C_SNAPSHOTS,
): PerEnvelopeSnapshotResult {
  const checks = snapshots.map((snapshot) => {
    const ack = findSnapshotAck(acks, snapshot);
    if (ack === null || ack.event !== "presentation_applied") {
      return {
        matchInstanceId: snapshot.matchInstanceId,
        sequence: snapshot.sequence,
        found: false,
        scoresMatch: false,
      };
    }
    return {
      matchInstanceId: snapshot.matchInstanceId,
      sequence: snapshot.sequence,
      found: true,
      scoresMatch: sameMultiset(ack.scoreValues ?? [], snapshot.scoreValues),
    };
  });
  return { checks, passed: checks.every((c) => c.found && c.scoresMatch) };
}

/**
 * Build one evidence row per gate-C snapshot, derived from the acknowledgement
 * itself so the two distinct scoreboards are visibly recorded in the table.
 */
export function buildSnapshotEvidenceRows(
  step: ProofStep,
  acks: ReadonlyArray<NormalizedUnityAck>,
  snapshots: ReadonlyArray<SnapshotExpectation> = GATE_C_SNAPSHOTS,
): ReadonlyArray<ProofEvidenceRow> {
  return snapshots.map((snapshot) => {
    const ack = findSnapshotAck(acks, snapshot);
    if (ack === null || ack.event !== "presentation_applied") {
      return buildHarnessEvidenceRow({
        step,
        status: "fail",
        failureCategory: "missing_acknowledgement",
      });
    }
    const scoresMatch = sameMultiset(ack.scoreValues ?? [], snapshot.scoreValues);
    return buildEvidenceRowFromAck(
      step,
      ack,
      scoresMatch ? "pass" : "fail",
      scoresMatch ? "none" : "unexpected_outcome",
    );
  });
}

// ── Network observation window ────────────────────────────────────────────────

/**
 * Only entries recorded AFTER the operator started the run may be observed. The
 * PerformanceObserver is created with `buffered: true` so nothing is missed once
 * the run begins, but buffering also replays pre-run Preview traffic (the page's
 * own chunks, an earlier navigation) which is not part of the proof.
 */
export function entryIsInsideProofWindow(
  entryStartTime: unknown,
  proofStartTime: number | null,
): boolean {
  if (proofStartTime === null) return false;
  if (typeof entryStartTime !== "number" || !Number.isFinite(entryStartTime)) return false;
  return entryStartTime >= proofStartTime;
}

// ── Acknowledgement validation ────────────────────────────────────────────────

/**
 * Normalize an inbound acknowledgement with the merged strict validator. The raw
 * object is never retained — only the normalized result is returned.
 */
export function normalizeAcknowledgement(raw: unknown): NormalizedUnityAck | null {
  return validateUnityAck(raw);
}

/** Does a normalized acknowledgement satisfy the step's expectation? */
export function acknowledgementMatches(step: ProofStep, ack: NormalizedUnityAck): boolean {
  const expect = step.expect;
  if (expect.kind === "applied") {
    if (ack.event !== "presentation_applied") return false;
    if (ack.appliedEvent !== expect.event) return false;
    if (ack.sequence !== expect.sequence) return false;
    if (ack.matchInstanceId !== expect.matchInstanceId) return false;
    if (expect.result !== undefined && ack.result !== expect.result) return false;
    if (expect.phase !== undefined && ack.phase !== expect.phase) return false;
    if (expect.scoreValues !== undefined) {
      // Compare as a MULTISET: the acknowledgement reports the values Unity
      // applied, and the compiled consumer makes no ordering guarantee. Both
      // sides are sorted ascending so `[0,1]` and `[1,0]` compare equal, while a
      // genuinely wrong scoreboard (e.g. `[0,2]`) still fails.
      const got = [...(ack.scoreValues ?? [])].sort((a, b) => a - b);
      const want = [...expect.scoreValues].sort((a, b) => a - b);
      if (got.length !== want.length) return false;
      for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) return false;
    }
    if (expect.suddenDeathRound !== undefined) {
      // The exact value must have survived React → Unity → React unchanged.
      if (ack.suddenDeathRound !== expect.suddenDeathRound) return false;
    }
    return true;
  }
  if (expect.kind === "rejected") {
    if (ack.event !== "presentation_rejected") return false;
    if (ack.reason !== expect.reason) return false;
    if (expect.sequence !== undefined && ack.sequence !== expect.sequence) return false;
    return true;
  }
  return false;
}

// ── Gate classification and report ────────────────────────────────────────────

export interface ProofGateResult {
  readonly gate: ProofGateId;
  readonly status: ProofStatus;
  readonly failureCategory: SafeFailureCategory;
  readonly stepCount: number;
}

/** Classify one gate from its evidence rows. Any failure fails the gate. */
export function classifyGate(
  gate: ProofGateId,
  rows: ReadonlyArray<ProofEvidenceRow>,
): ProofGateResult {
  const own = rows.filter((r) => r.gate === gate);
  if (own.length === 0) {
    return { gate, status: "pending", failureCategory: "none", stepCount: 0 };
  }
  const failed = own.find((r) => r.status === "fail");
  if (failed) {
    return { gate, status: "fail", failureCategory: failed.failureCategory, stepCount: own.length };
  }
  if (own.some((r) => r.status === "pending")) {
    return { gate, status: "pending", failureCategory: "none", stepCount: own.length };
  }
  return { gate, status: "pass", failureCategory: "none", stepCount: own.length };
}

export type NetworkCategory =
  | "cohort_status"
  | "cohort_session"
  | "protected_player_entry"
  | "protected_unity_artifact"
  | "other_same_origin_static"
  /**
   * A cross-origin request to the configured Supabase auth origin. The MERGED
   * cohort gate reads the browser session before it calls the PR-1 routes, so a
   * token refresh here is expected and is NOT a gameplay path. It is recorded as
   * its own category rather than hidden inside `other_same_origin_static`.
   */
  | "third_party_auth"
  | "prohibited";

/**
 * True when `segment` appears as a full path segment (case-insensitive).
 * Avoids false positives from Next chunk filenames that merely contain a
 * gameplay word (e.g. `/_next/static/chunks/app-match-abc.js`).
 */
function pathHasSegment(pathname: string, segment: string): boolean {
  const needle = segment.toLowerCase();
  return pathname
    .toLowerCase()
    .split("/")
    .filter((part) => part.length > 0)
    .some((part) => part === needle);
}

/**
 * Classify a request path into a SAFE category. Full URLs and query strings are
 * never retained. Anything gameplay-authoritative is `prohibited`.
 *
 * Known same-origin Next.js static/framework prefixes are classified BEFORE
 * gameplay segment checks so chunk names containing words like "match" stay
 * `other_same_origin_static`.
 */
export function classifyNetworkPath(rawPath: unknown): NetworkCategory {
  if (typeof rawPath !== "string" || rawPath.length === 0) return "prohibited";
  const path = rawPath.split("?")[0].split("#")[0];
  const lower = path.toLowerCase();
  if (lower.startsWith("ws:") || lower.startsWith("wss:")) return "prohibited";
  if (lower.includes("/socket.io")) return "prohibited";
  if (lower.includes("railway")) return "prohibited";
  // Static / framework traffic first — before gameplay substring/segment checks.
  if (lower.startsWith("/_next/") || lower.startsWith("/favicon")) {
    return "other_same_origin_static";
  }
  if (
    pathHasSegment(path, "wallet") ||
    pathHasSegment(path, "economy") ||
    pathHasSegment(path, "payout")
  ) {
    return "prohibited";
  }
  if (
    pathHasSegment(path, "match") ||
    pathHasSegment(path, "pick") ||
    pathHasSegment(path, "room")
  ) {
    return "prohibited";
  }
  if (path === "/api/unity-cohort/status") return "cohort_status";
  if (path === "/api/unity-cohort/session") return "cohort_session";
  if (path === REQUIRED_BUILD_URL) return "protected_player_entry";
  if (path.startsWith("/unity-arena/artifact/")) return "protected_unity_artifact";
  if (path.startsWith("/")) return "other_same_origin_static";
  return "prohibited";
}

/**
 * Classify an observed absolute request URL into a SAFE category, given the page
 * origin and the configured auth origin. Only the CATEGORY is ever retained — the
 * URL, its query string and its headers are discarded here and never stored.
 *
 * Anything that is neither same-origin nor the auth origin is `prohibited`, so an
 * unexpected third party (a realtime host, a CDN, an analytics beacon on another
 * origin) fails the proof rather than passing unnoticed.
 */
export function classifyNetworkUrl(
  rawUrl: unknown,
  pageOrigin: string,
  authOrigin: string | null,
): NetworkCategory {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return "prohibited";
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, pageOrigin);
  } catch {
    return "prohibited";
  }
  if (parsed.protocol === "ws:" || parsed.protocol === "wss:") return "prohibited";
  if (parsed.origin === pageOrigin) return classifyNetworkPath(parsed.pathname);
  if (authOrigin !== null && authOrigin.length > 0 && parsed.origin === authOrigin) {
    return "third_party_auth";
  }
  return "prohibited";
}

export interface ProofReport {
  readonly baseline: string;
  readonly route: string;
  readonly gates: ReadonlyArray<ProofGateResult>;
  readonly rows: ReadonlyArray<ProofEvidenceRow>;
  readonly maxIframeCount: number;
  readonly networkCategories: ReadonlyArray<NetworkCategory>;
  /** True when the harness itself faulted. Always forces `overall: "fail"`. */
  readonly harnessFault: boolean;
  readonly overall: ProofStatus;
}

export const PROOF_BASELINE_SHA = "231264be0946941933face8c0d4442adc952d414" as const;
export const PROOF_ROUTE = "/dev/unity-b6d3c" as const;

/**
 * Build the final sanitized report.
 *
 * The run FAILS on any gate failure, a violated one-iframe invariant, a
 * prohibited network category, or a harness fault. A harness fault always wins:
 * an unexpected exception means the plan did not complete as written, so the
 * report can never be reported as a pass no matter what evidence was collected.
 *
 * The run can never PASS while any row is still `pending`: an unresolved
 * dispatch is not evidence of anything, so it degrades the run to `pending`.
 *
 * Throws (rather than emitting) if anything prohibited would be included.
 */
export function buildProofReport(args: {
  rows: ReadonlyArray<ProofEvidenceRow>;
  maxIframeCount: number;
  networkCategories: ReadonlyArray<NetworkCategory>;
  harnessFault?: boolean;
}): ProofReport {
  const gates = PROOF_GATE_IDS.map((g) => classifyGate(g, args.rows));
  const anyFail = gates.some((g) => g.status === "fail");
  const anyPendingGate = gates.some((g) => g.status === "pending");
  const anyPendingRow = args.rows.some((r) => r.status === "pending");
  const iframeViolation = args.maxIframeCount > 1;
  const networkViolation = args.networkCategories.includes("prohibited");
  const harnessFault = args.harnessFault === true;

  const overall: ProofStatus =
    anyFail || iframeViolation || networkViolation || harnessFault
      ? "fail"
      : anyPendingGate || anyPendingRow
        ? "pending"
        : "pass";

  const report: ProofReport = {
    baseline: PROOF_BASELINE_SHA,
    route: PROOF_ROUTE,
    gates,
    rows: args.rows,
    maxIframeCount: args.maxIframeCount,
    networkCategories: args.networkCategories,
    harnessFault,
    overall,
  };
  assertNoProhibitedValues(report);
  return report;
}

// ── The deterministic proof plan ──────────────────────────────────────────────

/**
 * Immutable, ordered proof plan. Sequences and instances are exact. Positive
 * lifecycle evidence flows through the host; only duplicate / stale /
 * foreign-instance negatives are injected directly.
 */
export const PROOF_STEPS: ReadonlyArray<ProofStep> = Object.freeze([
  {
    step: 1,
    gate: "A_BOOTSTRAP",
    label: "Unity ready (proof iframe)",
    channel: "harness",
    action: "observe",
    timeoutLabel: "load",
    expect: { kind: "ready" },
  },
  {
    step: 2,
    gate: "A_BOOTSTRAP",
    label: "bootstrap state sync 0/0, round 1, NORMAL",
    channel: "host",
    action: "send",
    timeoutLabel: "standard",
    expect: {
      kind: "applied",
      event: "match_state_sync",
      sequence: 1,
      matchInstanceId: PROOF_INSTANCE_A,
      phase: "NORMAL",
      scoreValues: [0, 0],
    },
  },
  {
    step: 3,
    gate: "B_RESULT_STATE_SEPARATION",
    label: "round_result GOAL carries no score",
    channel: "host",
    action: "send",
    timeoutLabel: "standard",
    expect: {
      kind: "applied",
      event: "round_result",
      sequence: 2,
      matchInstanceId: PROOF_INSTANCE_A,
      result: "GOAL",
    },
  },
  {
    step: 4,
    gate: "B_RESULT_STATE_SEPARATION",
    label: "authoritative state sync applies the score change",
    channel: "host",
    action: "send",
    timeoutLabel: "standard",
    expect: {
      kind: "applied",
      event: "match_state_sync",
      sequence: 3,
      matchInstanceId: PROOF_INSTANCE_A,
      phase: "NORMAL",
      scoreValues: [0, 1],
    },
  },
  {
    step: 5,
    gate: "C_PER_ENVELOPE_SCORES",
    label: "acknowledged snapshots retain their own values (seq 1 = 0/0, seq 3 = 0/1)",
    channel: "harness",
    action: "observe",
    timeoutLabel: "short",
    // Gate C is proven from the ACKNOWLEDGEMENTS Unity returned for sequences 1
    // and 3 (see GATE_C_SNAPSHOTS), not from host visibility. The host-state
    // expectation below is an ADDITIONAL requirement, never a substitute.
    expect: { kind: "host-state", hostState: "UNITY_READY_VISIBLE", iframeCount: 1 },
  },
  {
    step: 6,
    gate: "D_DUPLICATE_STALE",
    label: "duplicate sequence 3 rejected (distinct proof message id)",
    channel: "direct-negative",
    action: "send",
    timeoutLabel: "standard",
    expect: { kind: "rejected", reason: "stale_or_duplicate", sequence: 3 },
  },
  {
    step: 7,
    gate: "D_DUPLICATE_STALE",
    label: "stale sequence 2 rejected",
    channel: "direct-negative",
    action: "send",
    timeoutLabel: "standard",
    expect: { kind: "rejected", reason: "stale_or_duplicate", sequence: 2 },
  },
  {
    step: 8,
    gate: "E_FOREIGN_INSTANCE",
    label: "foreign-instance envelope never reaches the host feed",
    channel: "harness",
    action: "observe",
    timeoutLabel: "short",
    expect: { kind: "not-delivered" },
  },
  {
    step: 9,
    gate: "E_FOREIGN_INSTANCE",
    label: "compiled Unity rejects a direct foreign-instance envelope",
    channel: "direct-negative",
    action: "send",
    timeoutLabel: "standard",
    expect: { kind: "rejected", reason: "foreign_instance" },
  },
  {
    step: 10,
    gate: "G_SUDDEN_DEATH",
    label: "SUDDEN_DEATH applied with suddenDeathRound exactly 1",
    channel: "host",
    action: "send",
    timeoutLabel: "standard",
    expect: {
      kind: "applied",
      event: "match_state_sync",
      sequence: 4,
      matchInstanceId: PROOF_INSTANCE_A,
      phase: "SUDDEN_DEATH",
      scoreValues: [3, 3],
      suddenDeathRound: 1,
    },
  },
  {
    step: 11,
    gate: "F_INSTANCE_TRANSITION",
    label: "new instance B6D3C01:2 accepted at sequence 1",
    channel: "host",
    action: "send",
    timeoutLabel: "standard",
    expect: {
      kind: "applied",
      event: "match_state_sync",
      sequence: 1,
      matchInstanceId: PROOF_INSTANCE_B,
      phase: "NORMAL",
      scoreValues: [0, 0],
    },
  },
  {
    step: 12,
    gate: "F_INSTANCE_TRANSITION",
    label: "old-instance envelope still rejected after transition",
    channel: "direct-negative",
    action: "send",
    timeoutLabel: "standard",
    expect: { kind: "rejected", reason: "foreign_instance" },
  },
  {
    step: 13,
    gate: "H_RELOAD_BOOTSTRAP",
    label: "reload the single proof iframe → fresh ready",
    channel: "harness",
    action: "reload",
    timeoutLabel: "load",
    expect: { kind: "ready" },
  },
  {
    step: 14,
    gate: "H_RELOAD_BOOTSTRAP",
    label: "post-reload complete bootstrap at sequence 5 (> 1)",
    channel: "host",
    action: "send",
    timeoutLabel: "standard",
    expect: {
      kind: "applied",
      event: "match_state_sync",
      sequence: 5,
      matchInstanceId: PROOF_INSTANCE_B,
      phase: "NORMAL",
      scoreValues: [1, 2],
    },
  },
  {
    step: 15,
    gate: "I_FAIL_OPEN",
    label: "native iframe error → terminal fallback, React underlay exposed",
    channel: "harness",
    action: "induce-error",
    timeoutLabel: "standard",
    expect: { kind: "host-state", hostState: "UNITY_FAILED_REACT_FALLBACK", iframeCount: 0 },
  },
  {
    step: 16,
    gate: "J_SANITIZATION",
    label: "no synthetic raw id in projections, evidence or report",
    channel: "harness",
    action: "observe",
    timeoutLabel: "short",
    expect: { kind: "not-delivered" },
  },
]);

/** Steps are strictly ordered from 1..N with no gaps or duplicates. */
export function proofStepOrderIsValid(steps: ReadonlyArray<ProofStep> = PROOF_STEPS): boolean {
  return steps.every((s, i) => s.step === i + 1);
}
