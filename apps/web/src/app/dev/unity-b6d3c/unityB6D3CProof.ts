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
  | "iframe_invariant_violation"
  | "sanitization_violation"
  | "network_violation"
  | "harness_error";

export const SAFE_FAILURE_CATEGORIES: ReadonlyArray<SafeFailureCategory> = Object.freeze([
  "none",
  "timeout",
  "unexpected_outcome",
  "unexpected_rejection",
  "missing_acknowledgement",
  "iframe_invariant_violation",
  "sanitization_violation",
  "network_violation",
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
  readonly playerCount: number | null;
  readonly appliedEvent: string | null;
  readonly rejectionReason: RejectReason | null;
  readonly hostState: string | null;
  readonly iframeCount: number | null;
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
  playerCount: null,
  appliedEvent: null,
  rejectionReason: null,
  hostState: null,
  iframeCount: null,
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
  failureCategory?: SafeFailureCategory;
}): ProofEvidenceRow {
  return {
    ...EMPTY_ROW,
    step: args.step.step,
    gate: args.step.gate,
    direction: "harness",
    hostState: args.hostState ?? null,
    iframeCount: args.iframeCount ?? null,
    status: args.status,
    failureCategory: args.failureCategory ?? "none",
  };
}

/** Build a sanitized evidence row for an outbound (React → Unity) dispatch. */
export function buildOutboundEvidenceRow(
  step: ProofStep,
  envelope: PresentationEnvelope,
  status: ProofStatus = "pending",
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
    playerCount: scoreValues ? scoreValues.length : null,
    status,
    failureCategory: "none",
  };
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
 * Classify a request path into a SAFE category. Full URLs and query strings are
 * never retained. Anything gameplay-authoritative is `prohibited`.
 */
export function classifyNetworkPath(rawPath: unknown): NetworkCategory {
  if (typeof rawPath !== "string" || rawPath.length === 0) return "prohibited";
  const path = rawPath.split("?")[0].split("#")[0];
  const lower = path.toLowerCase();
  if (lower.startsWith("ws:") || lower.startsWith("wss:")) return "prohibited";
  if (lower.includes("/socket.io")) return "prohibited";
  if (lower.includes("railway")) return "prohibited";
  if (lower.includes("/wallet") || lower.includes("/economy") || lower.includes("/payout")) {
    return "prohibited";
  }
  if (lower.includes("/match") || lower.includes("/pick") || lower.includes("/room")) {
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
  readonly overall: ProofStatus;
}

export const PROOF_BASELINE_SHA = "231264be0946941933face8c0d4442adc952d414" as const;
export const PROOF_ROUTE = "/dev/unity-b6d3c" as const;

/**
 * Build the final sanitized report. Fails the proof on any gate failure, on a
 * violated one-iframe invariant, or on a prohibited network category, and throws
 * (rather than emitting) if anything prohibited would be included.
 */
export function buildProofReport(args: {
  rows: ReadonlyArray<ProofEvidenceRow>;
  maxIframeCount: number;
  networkCategories: ReadonlyArray<NetworkCategory>;
}): ProofReport {
  const gates = PROOF_GATE_IDS.map((g) => classifyGate(g, args.rows));
  const anyFail = gates.some((g) => g.status === "fail");
  const anyPending = gates.some((g) => g.status === "pending");
  const iframeViolation = args.maxIframeCount > 1;
  const networkViolation = args.networkCategories.includes("prohibited");

  const overall: ProofStatus =
    anyFail || iframeViolation || networkViolation ? "fail" : anyPending ? "pending" : "pass";

  const report: ProofReport = {
    baseline: PROOF_BASELINE_SHA,
    route: PROOF_ROUTE,
    gates,
    rows: args.rows,
    maxIframeCount: args.maxIframeCount,
    networkCategories: args.networkCategories,
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
    label: "queued snapshots retain their own values (0/0 then 1/0)",
    channel: "harness",
    action: "observe",
    timeoutLabel: "short",
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
    label: "SUDDEN_DEATH applied with supplied suddenDeathRound",
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
    label: "native iframe error → terminal fallback, renderer removed",
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
