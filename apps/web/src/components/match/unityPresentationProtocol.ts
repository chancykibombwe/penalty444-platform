/**
 * B6D1 — Versioned Unity presentation protocol (STANDALONE, presentation-only).
 *
 * This module defines a versioned, presentation-only message contract for a
 * FUTURE Unity real-match integration. It is pure TypeScript groundwork:
 *
 *   - It is NOT wired into MatchRoomPanel or MatchRenderer3D.
 *   - It does NOT open sockets, read Supabase, or touch React state.
 *   - It carries NO auth/Supabase/Socket.IO credentials and NO wallet/economy
 *     data — Unity remains presentation-only and never authoritative.
 *
 * Canonical match vocabulary (`Lane`, `ShotResult`, `MatchPhase`) is imported
 * from `matchPresentation.ts` and never duplicated here.
 *
 * See docs/unity-b6d1-contract-adapter.md and
 * docs/unity-b6d-real-match-integration-scope.md. B6D2 is NOT authorized.
 */

import type { Lane, ShotResult, MatchPhase } from "./matchPresentation";
import { isValidLane } from "./matchPresentation";

// ── Envelope constants ────────────────────────────────────────────────────────
export const PRESENTATION_TYPE = "PENALTY444_MATCH_EVENT" as const;
export const PRESENTATION_PROTOCOL_VERSION = 1 as const;

export type PresentationEventName = "round_result" | "match_state_sync";

// ── Payloads ──────────────────────────────────────────────────────────────────

/** Drives the shot animation ONLY. Never carries scores/phase/maxRounds. */
export interface RoundResultPayload {
  round: number;
  kickerLane: Lane;
  keeperLane: Lane;
  result: ShotResult;
  statusMessage?: string;
}

/** Drives the scoreboard/phase ONLY. Built only from authoritative snapshots. */
export interface MatchStateSyncPayload {
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  phase: MatchPhase;
  suddenDeathRound?: number;
}

// ── Envelope ──────────────────────────────────────────────────────────────────

interface BaseEnvelope {
  type: typeof PRESENTATION_TYPE;
  protocolVersion: typeof PRESENTATION_PROTOCOL_VERSION;
  matchInstanceId: string;
  sequence: number;
  emittedAt?: number;
}

export interface RoundResultEnvelope extends BaseEnvelope {
  event: "round_result";
  payload: RoundResultPayload;
}

export interface MatchStateSyncEnvelope extends BaseEnvelope {
  event: "match_state_sync";
  payload: MatchStateSyncPayload;
}

export type PresentationEnvelope = RoundResultEnvelope | MatchStateSyncEnvelope;

// ── Primitive validators (never throw) ─────────────────────────────────────────

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isValidMatchInstanceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidSequence(value: unknown): value is number {
  return isPositiveSafeInteger(value);
}

/** `emittedAt` is optional; when present it must be a finite non-negative safe int. */
export function isValidEmittedAt(value: unknown): value is number {
  return isNonNegativeSafeInteger(value);
}

export function isShotResult(value: unknown): value is ShotResult {
  return value === "GOAL" || value === "SAVE" || value === "DRAW";
}

export function isMatchPhase(value: unknown): value is MatchPhase {
  return value === "NORMAL" || value === "SUDDEN_DEATH";
}

// Keys that must never be accepted as score player-ids (prototype-pollution guard).
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

// ── Full-envelope validation (defensive; returns the narrowed type or null) ─────

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validateRoundResultPayload(value: unknown): RoundResultPayload | null {
  if (!isPlainRecord(value)) return null;
  if (!isPositiveSafeInteger(value.round)) return null;
  if (!isValidLane(value.kickerLane)) return null;
  if (!isValidLane(value.keeperLane)) return null;
  if (!isShotResult(value.result)) return null;
  const out: RoundResultPayload = {
    round: value.round,
    kickerLane: value.kickerLane,
    keeperLane: value.keeperLane,
    result: value.result,
  };
  if (typeof value.statusMessage === "string") {
    const normalized = normalizeStatusMessage(value.statusMessage);
    if (normalized !== null) out.statusMessage = normalized;
  }
  return out;
}

/** Trim, drop control chars, cap length; returns null when empty after cleanup. */
export function normalizeStatusMessage(value: string): string | null {
  // Replace ASCII control chars (code < 0x20, or DEL 0x7F) with spaces —
  // done via code-point check to avoid control chars in a regex literal.
  let cleaned = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? " " : ch;
  }
  cleaned = cleaned.trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 200);
}

/**
 * Defensively clone a raw scores map into a NEW sanitized object:
 * own enumerable string keys only, non-empty and non-dangerous keys, finite
 * non-negative integer values. Returns null on any violation. Never retains a
 * reference to the source object.
 */
export function sanitizeScores(raw: unknown): Record<string, number> | null {
  if (!isPlainRecord(raw)) return null;
  const out: Record<string, number> = {};
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (key.length === 0) return null;
    if (isDangerousKey(key)) return null;
    let val: unknown;
    try {
      val = raw[key];
    } catch {
      return null;
    }
    if (typeof val !== "number" || !Number.isSafeInteger(val) || val < 0) {
      return null;
    }
    out[key] = val;
  }
  return out;
}

function validateMatchStateSyncPayload(value: unknown): MatchStateSyncPayload | null {
  if (!isPlainRecord(value)) return null;
  const scores = sanitizeScores(value.scores);
  if (scores === null) return null;
  if (!isPositiveSafeInteger(value.round)) return null;
  if (!isPositiveSafeInteger(value.maxRounds)) return null;
  if (!isMatchPhase(value.phase)) return null;
  const out: MatchStateSyncPayload = {
    scores,
    round: value.round,
    maxRounds: value.maxRounds,
    phase: value.phase,
  };
  if (value.suddenDeathRound !== undefined) {
    if (!isNonNegativeSafeInteger(value.suddenDeathRound)) return null;
    out.suddenDeathRound = value.suddenDeathRound;
  }
  return out;
}

/**
 * Validate a fully-formed envelope object. Returns the narrowed
 * PresentationEnvelope or null. Never throws.
 */
export function validateEnvelope(value: unknown): PresentationEnvelope | null {
  if (!isPlainRecord(value)) return null;
  if (value.type !== PRESENTATION_TYPE) return null;
  if (value.protocolVersion !== PRESENTATION_PROTOCOL_VERSION) return null;
  if (!isValidMatchInstanceId(value.matchInstanceId)) return null;
  if (!isValidSequence(value.sequence)) return null;
  if (value.emittedAt !== undefined && !isValidEmittedAt(value.emittedAt)) return null;

  if (value.event === "round_result") {
    const payload = validateRoundResultPayload(value.payload);
    if (payload === null) return null;
    return buildEnvelope("round_result", value.matchInstanceId, value.sequence, value.emittedAt, payload);
  }
  if (value.event === "match_state_sync") {
    const payload = validateMatchStateSyncPayload(value.payload);
    if (payload === null) return null;
    return buildEnvelope("match_state_sync", value.matchInstanceId, value.sequence, value.emittedAt, payload);
  }
  return null;
}

// ── Envelope construction (field-by-field; never spreads raw payloads) ─────────

function buildEnvelope(
  event: "round_result",
  matchInstanceId: string,
  sequence: number,
  emittedAt: number | undefined,
  payload: RoundResultPayload,
): RoundResultEnvelope;
function buildEnvelope(
  event: "match_state_sync",
  matchInstanceId: string,
  sequence: number,
  emittedAt: number | undefined,
  payload: MatchStateSyncPayload,
): MatchStateSyncEnvelope;
function buildEnvelope(
  event: PresentationEventName,
  matchInstanceId: string,
  sequence: number,
  emittedAt: number | undefined,
  payload: RoundResultPayload | MatchStateSyncPayload,
): PresentationEnvelope {
  const base = {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId,
    sequence,
    event,
    payload,
  } as PresentationEnvelope;
  // Only include emittedAt when it is a valid value (exact output keys).
  if (emittedAt !== undefined && isValidEmittedAt(emittedAt)) {
    base.emittedAt = emittedAt;
  }
  return base;
}

export { buildEnvelope };

// ── matchInstanceId derivation (§5) ────────────────────────────────────────────

/**
 * Derive the protocol match-instance identifier from the browser-available
 * `roomCode` + numeric `matchInstance`. The server's internal string
 * `matchInstanceId` is NOT currently forwarded to the browser, so B6D1
 * deliberately uses roomCode + matchInstance and requires no server change.
 *
 * Format: `<UPPERCASE_TRIMMED_ROOM_CODE>:<POSITIVE_MATCH_INSTANCE>` (e.g.
 * `ABCD12:3`). Returns null on malformed input (never throws). Contains no
 * player ids, auth info, or tokens.
 */
export function deriveMatchInstanceId(
  roomCode: unknown,
  matchInstance: unknown,
): string | null {
  if (typeof roomCode !== "string") return null;
  const trimmed = roomCode.trim();
  if (trimmed.length === 0) return null;
  // Room codes are alphanumeric; reject anything else so the ":" delimiter stays
  // unambiguous and no whitespace/PII/tokens can enter the identifier.
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return null;
  if (!isPositiveSafeInteger(matchInstance)) return null;
  return `${trimmed.toUpperCase()}:${matchInstance}`;
}

// ── Sequence + instance reference logic (§9) ───────────────────────────────────

/**
 * SENDER-side sequence emitter (reference logic). Sequence starts at 1 for a
 * match instance and increases monotonically in actual send order; a new
 * matchInstanceId resets the sequence to 1. Pure/deterministic.
 */
export class PresentationSequenceEmitter {
  private instanceId: string | null = null;
  private last = 0;

  /** Returns the next sequence for `instanceId`, resetting on instance change. */
  next(instanceId: string): number {
    if (!isValidMatchInstanceId(instanceId)) {
      throw new Error("PresentationSequenceEmitter.next: invalid matchInstanceId");
    }
    if (instanceId !== this.instanceId) {
      this.instanceId = instanceId;
      this.last = 0;
    }
    this.last += 1;
    return this.last;
  }

  currentInstanceId(): string | null {
    return this.instanceId;
  }
}

export type GateDecision =
  | { accepted: true }
  | { accepted: false; reason: "no-active-instance" | "foreign-instance" | "stale-or-duplicate" | "invalid-envelope" };

/**
 * RECEIVER-side ordering gate (reference logic — what Unity would enforce).
 * The active instance change MUST be explicit (`beginInstance`); it is never
 * silently inferred from an incoming message. Duplicate or lower sequence for
 * the active instance is rejected; a message from any other instance is
 * rejected once the active instance is set.
 */
export class PresentationSequenceGate {
  private activeInstanceId: string | null = null;
  private lastAccepted = 0;

  /** Explicitly set the active match instance and reset the sequence floor. */
  beginInstance(instanceId: string): void {
    if (!isValidMatchInstanceId(instanceId)) {
      throw new Error("PresentationSequenceGate.beginInstance: invalid matchInstanceId");
    }
    this.activeInstanceId = instanceId;
    this.lastAccepted = 0;
  }

  activeInstance(): string | null {
    return this.activeInstanceId;
  }

  lastSequence(): number {
    return this.lastAccepted;
  }

  /** Decide whether a validated envelope may be applied. Never throws. */
  accept(envelope: unknown): GateDecision {
    const valid = validateEnvelope(envelope);
    if (valid === null) return { accepted: false, reason: "invalid-envelope" };
    if (this.activeInstanceId === null) {
      return { accepted: false, reason: "no-active-instance" };
    }
    if (valid.matchInstanceId !== this.activeInstanceId) {
      return { accepted: false, reason: "foreign-instance" };
    }
    if (valid.sequence <= this.lastAccepted) {
      return { accepted: false, reason: "stale-or-duplicate" };
    }
    this.lastAccepted = valid.sequence;
    return { accepted: true };
  }
}
