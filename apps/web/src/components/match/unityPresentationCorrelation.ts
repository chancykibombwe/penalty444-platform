/**
 * B6D3A — result-to-state correlation contract (STANDALONE, pure).
 *
 * Evaluates the authoritative relationship between a presentation `round_result`
 * event and a later authoritative `match_state_sync`, per
 * docs/unity-b6d3-player-facing-integration-scope.md §8 and the B6D score-atomicity
 * facts (§6): the server increments `room.scores` BEFORE it emits `match:result`,
 * and `match:result` carries NO scores; the authoritative post-result scoreboard
 * only ever reaches a client on a later `match:update` (→ `match_state_sync`).
 *
 * This module is pure groundwork ONLY:
 *   - It is NOT wired into MatchRoomPanel / MatchRenderer3D / the shadow dispatch.
 *   - It emits NOTHING to Unity and adds NO postMessage event.
 *   - It does NOT change any serialized Protocol v1 envelope or its wire shape.
 *   - It does NOT duplicate the streaming `PresentationSequenceGate`; it composes
 *     with the existing `validateEnvelope` to relate ONE result to ONE state sync.
 *
 * It NEVER computes a score delta, a winner, the next round, or sudden-death
 * progression. Only `match_state_sync` is score-bearing; `round_result` is
 * result-presentation only. Every function returns a typed rejection on malformed
 * or hostile input and NEVER throws. Outputs carry no raw payloads and no ids
 * beyond the non-identifying `matchInstanceId`.
 *
 * See docs/unity-b6d3a-identity-correlation-contract.md. B6D3B is NOT authorized.
 */

import type { MatchPhase } from "./matchPresentation";
import {
  validateEnvelope,
  type MatchStateSyncEnvelope,
  type PresentationEnvelope,
  type PresentationEventName,
  type RoundResultEnvelope,
} from "./unityPresentationProtocol";

// ── Result vocabulary ───────────────────────────────────────────────────────────

export type CorrelationRejectReason =
  | "invalid-result-envelope"
  | "invalid-state-sync-envelope"
  | "wrong-event-type"
  | "foreign-instance"
  | "stale-or-duplicate"
  | "invalid-round-order";

/** Sanitized correlation summary. No raw payloads; no player ids. */
export interface CorrelationSummary {
  matchInstanceId: string;
  resultSequence: number;
  stateSyncSequence: number;
  /** Copied verbatim from the two authoritative envelopes (never recomputed). */
  resultRound: number;
  stateSyncRound: number;
  /** Authoritative phase from the state sync (drives phase presentation). */
  phase: MatchPhase;
  /** Sorted numeric score VALUES from the state sync — never keyed by id. */
  scoreValues: number[];
  /** Present only when the authoritative state sync carried it. */
  suddenDeathRound?: number;
}

export type CorrelationResult =
  | { correlated: true; summary: CorrelationSummary }
  | { correlated: false; reason: CorrelationRejectReason };

// ── Invariant helper (documents the score-bearing rule) ─────────────────────────

/**
 * The single score-bearing presentation event. `round_result` is presentation-only
 * and NEVER changes a displayed score; only `match_state_sync` does. Exposed so the
 * invariant is explicit and unit-testable.
 */
export function isScoreBearingEvent(event: PresentationEventName): boolean {
  return event === "match_state_sync";
}

// ── Sorted numeric score values (no ids) ────────────────────────────────────────

function sortedScoreValues(envelope: MatchStateSyncEnvelope): number[] {
  return Object.values(envelope.payload.scores)
    .filter((v): v is number => typeof v === "number")
    .slice()
    .sort((a, b) => a - b);
}

// ── Public correlation evaluator ────────────────────────────────────────────────

/**
 * Evaluate whether `rawStateSync` is a valid authoritative state sync that
 * correlates to the earlier `rawResult` for the SAME match instance.
 *
 * Accept iff (in order):
 *   1. `rawResult` validates as a versioned envelope AND is `round_result`.
 *   2. `rawStateSync` validates as a versioned envelope AND is `match_state_sync`.
 *   3. both carry the SAME `matchInstanceId` (else `foreign-instance` — this is
 *      what separates a rematch/new-instance state sync from an old result).
 *   4. `stateSync.sequence` is STRICTLY greater than `result.sequence` (a lower or
 *      equal sequence is `stale-or-duplicate`).
 *   5. the round relationship is authoritative: `stateSync.round === result.round`
 *      (terminal final state) OR `stateSync.round === result.round + 1`
 *      (non-terminal continuation). A lower round or a jump of two or more is
 *      `invalid-round-order`. The next round is VALIDATED, never calculated.
 *
 * On accept, returns a sanitized `CorrelationSummary` (score values only, no ids
 * beyond `matchInstanceId`, no raw payload). The round numbers are copied verbatim
 * and never used to derive a "next round"; the score values come only from the
 * state sync (never from the result). No winner, score delta, phase, or
 * sudden-death progression is derived. Never throws.
 */
export function correlateResultToStateSync(
  rawResult: unknown,
  rawStateSync: unknown,
): CorrelationResult {
  try {
    const result = validateEnvelope(rawResult);
    if (result === null) return { correlated: false, reason: "invalid-result-envelope" };
    const stateSync = validateEnvelope(rawStateSync);
    if (stateSync === null) {
      return { correlated: false, reason: "invalid-state-sync-envelope" };
    }

    // Event roles must be exactly result → state sync (rejects a swapped pair).
    if (result.event !== "round_result" || stateSync.event !== "match_state_sync") {
      return { correlated: false, reason: "wrong-event-type" };
    }

    // Narrow now that the events are confirmed.
    const resultEnv = result as RoundResultEnvelope;
    const stateEnv = stateSync as MatchStateSyncEnvelope;

    if (resultEnv.matchInstanceId !== stateEnv.matchInstanceId) {
      return { correlated: false, reason: "foreign-instance" };
    }

    // The authoritative state sync must strictly follow the result in sequence.
    if (stateEnv.sequence <= resultEnv.sequence) {
      return { correlated: false, reason: "stale-or-duplicate" };
    }

    // Round-order relationship — VALIDATE the two supplied authoritative round
    // values; NEVER calculate the next round. Per current server behaviour after a
    // `match:result` (see contract doc §10):
    //   - terminal final state sync:      stateSync.round === result.round
    //   - non-terminal continuation sync: stateSync.round === result.round + 1
    // A lower round, or a jump of two or more, is `invalid-round-order`.
    const roundDelta = stateEnv.payload.round - resultEnv.payload.round;
    if (roundDelta !== 0 && roundDelta !== 1) {
      return { correlated: false, reason: "invalid-round-order" };
    }

    const summary: CorrelationSummary = {
      matchInstanceId: stateEnv.matchInstanceId,
      resultSequence: resultEnv.sequence,
      stateSyncSequence: stateEnv.sequence,
      resultRound: resultEnv.payload.round,
      stateSyncRound: stateEnv.payload.round,
      phase: stateEnv.payload.phase,
      scoreValues: sortedScoreValues(stateEnv),
    };
    if (stateEnv.payload.suddenDeathRound !== undefined) {
      summary.suddenDeathRound = stateEnv.payload.suddenDeathRound;
    }
    return { correlated: true, summary };
  } catch {
    // Defensive: any unexpected throw is a controlled rejection, not a crash.
    return { correlated: false, reason: "invalid-result-envelope" };
  }
}

// Re-export the envelope union type for consumers that compose correlation with
// other B6D1 utilities without importing the protocol module directly.
export type { PresentationEnvelope };
