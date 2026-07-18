/**
 * B6D1 — Sanitizing adapter (STANDALONE, presentation-only).
 *
 * Maps UNTRUSTED authoritative socket payloads (`match:result`, `match:update`,
 * `match:rejoinState`, `match:end`) into the versioned Unity presentation
 * envelope (see `unityPresentationProtocol.ts`), building every output
 * field-by-field. It NEVER spreads a raw payload into the output, NEVER derives
 * a result or a score, and NEVER lets an auth/Supabase/Socket.IO/wallet/economy
 * field reach Unity. Every function returns a controlled `null` on malformed
 * input and never throws.
 *
 * This is pure groundwork: it is NOT wired to MatchRoomPanel/MatchRenderer3D and
 * does not touch React state, sockets, Supabase, or the live match. B6D2 is NOT
 * authorized.
 */

import { isValidLane } from "./matchPresentation";
import {
  buildEnvelope,
  isMatchPhase,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isShotResult,
  isValidEmittedAt,
  isValidMatchInstanceId,
  isValidSequence,
  normalizeStatusMessage,
  sanitizeScores,
  type MatchStateSyncEnvelope,
  type MatchStateSyncPayload,
  type RoundResultEnvelope,
} from "./unityPresentationProtocol";

export interface AdapterBuildOpts {
  matchInstanceId: string;
  sequence: number;
  emittedAt?: number;
}

/** A previously-accepted complete state snapshot, tagged with its instance. */
export interface PriorStateSnapshot {
  matchInstanceId: string;
  payload: MatchStateSyncPayload;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validBuildOpts(opts: AdapterBuildOpts): boolean {
  if (!isValidMatchInstanceId(opts.matchInstanceId)) return false;
  if (!isValidSequence(opts.sequence)) return false;
  if (opts.emittedAt !== undefined && !isValidEmittedAt(opts.emittedAt)) return false;
  return true;
}

/**
 * `match:result` → `round_result` envelope. NO scores / phase / maxRounds are
 * ever included. Maps `kickerPick → kickerLane`, `keeperPick → keeperLane`. The
 * lanes and result come only from the authoritative payload; nothing is derived.
 */
export function buildRoundResultEnvelope(
  rawMatchResult: unknown,
  opts: AdapterBuildOpts,
): RoundResultEnvelope | null {
  try {
    if (!validBuildOpts(opts)) return null;
    if (!isPlainRecord(rawMatchResult)) return null;

    const kickerLane = rawMatchResult.kickerPick;
    const keeperLane = rawMatchResult.keeperPick;
    const result = rawMatchResult.result;
    const round = rawMatchResult.round;

    if (!isValidLane(kickerLane)) return null;
    if (!isValidLane(keeperLane)) return null;
    if (!isShotResult(result)) return null;
    if (!isPositiveSafeInteger(round)) return null;

    const payload = {
      round,
      kickerLane,
      keeperLane,
      result,
    } as RoundResultEnvelope["payload"];

    // Optional, sanitized/normalized; invalid → simply omitted (not a rejection).
    if (typeof rawMatchResult.statusMessage === "string") {
      const normalized = normalizeStatusMessage(rawMatchResult.statusMessage);
      if (normalized !== null) payload.statusMessage = normalized;
    }

    return buildEnvelope("round_result", opts.matchInstanceId, opts.sequence, opts.emittedAt, payload);
  } catch {
    return null;
  }
}

/**
 * A COMPLETE authoritative state snapshot → `match_state_sync` envelope. Only a
 * payload that already carries scores + round + maxRounds + phase is accepted.
 *
 * NOTE [repo fact]: `match:update` (index.ts:720-739) IS a complete snapshot.
 * `match:rejoinState` (rooms.ts:464-484) as currently emitted does NOT carry
 * `scores` or `maxRounds`, so a RAW rejoinState is intentionally rejected here
 * (returns null) rather than fabricated — the complete reconnect snapshot must
 * come from the `match:update` the server also emits. See docs.
 */
export function buildMatchStateSyncEnvelope(
  rawSnapshot: unknown,
  opts: AdapterBuildOpts,
): MatchStateSyncEnvelope | null {
  try {
    if (!validBuildOpts(opts)) return null;
    if (!isPlainRecord(rawSnapshot)) return null;

    const scores = sanitizeScores(rawSnapshot.scores);
    if (scores === null) return null;
    if (!isPositiveSafeInteger(rawSnapshot.round)) return null;
    if (!isPositiveSafeInteger(rawSnapshot.maxRounds)) return null;
    if (!isMatchPhase(rawSnapshot.phase)) return null;

    const payload: MatchStateSyncPayload = {
      scores,
      round: rawSnapshot.round,
      maxRounds: rawSnapshot.maxRounds,
      phase: rawSnapshot.phase,
    };
    if (rawSnapshot.suddenDeathRound !== undefined) {
      if (!isNonNegativeSafeInteger(rawSnapshot.suddenDeathRound)) return null;
      payload.suddenDeathRound = rawSnapshot.suddenDeathRound;
    }

    return buildEnvelope("match_state_sync", opts.matchInstanceId, opts.sequence, opts.emittedAt, payload);
  } catch {
    return null;
  }
}

/**
 * Terminal `match:end` → `match_state_sync` envelope, combining ONLY:
 *   - the final authoritative scores from `match:end`; and
 *   - round / maxRounds / phase / suddenDeathRound from the last complete
 *     authoritative snapshot for the SAME matchInstanceId.
 *
 * If `prior` is absent or belongs to another match instance, returns null (never
 * fabricates round/maxRounds/phase). NOTE: the server also emits a full match
 * state after `match:end`; that later authoritative `match:update` is the
 * PREFERRED complete terminal sync (via buildMatchStateSyncEnvelope). This
 * combiner exists only as a defensive fallback.
 */
export function buildTerminalStateSyncEnvelope(
  rawMatchEnd: unknown,
  prior: PriorStateSnapshot | null,
  opts: AdapterBuildOpts,
): MatchStateSyncEnvelope | null {
  try {
    if (!validBuildOpts(opts)) return null;
    if (!isPlainRecord(rawMatchEnd)) return null;
    if (prior === null) return null;
    if (!isValidMatchInstanceId(prior.matchInstanceId)) return null;
    // Same-instance only — a foreign prior snapshot is rejected.
    if (prior.matchInstanceId !== opts.matchInstanceId) return null;

    const scores = sanitizeScores(rawMatchEnd.scores);
    if (scores === null) return null;

    // Non-score fields come only from the prior COMPLETE snapshot, re-validated.
    const p = prior.payload;
    if (!isPlainRecord(p)) return null;
    if (!isPositiveSafeInteger(p.round)) return null;
    if (!isPositiveSafeInteger(p.maxRounds)) return null;
    if (!isMatchPhase(p.phase)) return null;

    const payload: MatchStateSyncPayload = {
      scores,
      round: p.round,
      maxRounds: p.maxRounds,
      phase: p.phase,
    };
    if (p.suddenDeathRound !== undefined) {
      if (!isNonNegativeSafeInteger(p.suddenDeathRound)) return null;
      payload.suddenDeathRound = p.suddenDeathRound;
    }

    return buildEnvelope("match_state_sync", opts.matchInstanceId, opts.sequence, opts.emittedAt, payload);
  } catch {
    return null;
  }
}
