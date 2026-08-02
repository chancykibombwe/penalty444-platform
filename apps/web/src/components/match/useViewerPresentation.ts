/**
 * B6D3B PR-2 — viewer presentation adapter (PURE; presentation-only).
 *
 * Bridges the merged B6D3A contracts into the player-facing host. It accepts
 * id-bearing React inputs and emits SANITIZED presentation data only.
 *
 * The single most important job here is the PLAYER-FACING MESSAGE PROJECTION.
 * The existing shadow `match_state_sync` envelopes carry a score map keyed by RAW
 * player ids. Those envelopes are fine for the identity-neutral shadow path, but
 * must never reach a player-facing surface. This module therefore clones each
 * state sync into a NEW envelope whose scores are keyed by deterministic visual
 * sides:
 *
 *     scores = { LEFT: identity.self.score, RIGHT: identity.opponent.score }
 *
 * Everything else is copied verbatim from the authoritative envelope. Nothing is
 * computed: no score arithmetic, no winner, no result, no round, no phase and no
 * sudden-death progression is ever derived here. `round_result` envelopes contain
 * no player ids, so they are copied unchanged.
 *
 * Protocol v1 and Unity C# are UNCHANGED: the projected envelope keeps the exact
 * top-level shape (`type`, `protocolVersion`, `matchInstanceId`, `sequence`,
 * `event`, `emittedAt`, `payload`) and is re-validated by the existing
 * `validateEnvelope` before it is emitted.
 *
 * This module never mutates its inputs and never contains a raw player id in its
 * output — `JSON.stringify(output)` is asserted clean by the unit tests.
 */

import { useMemo } from "react";

import {
  buildViewerIdentityContext,
  type ViewerIdentityContext,
} from "./unityPresentationIdentity";
import {
  correlateResultToStateSync,
  type CorrelationSummary,
} from "./unityPresentationCorrelation";
import {
  validateEnvelope,
  type MatchStateSyncEnvelope,
  type PresentationEnvelope,
} from "./unityPresentationProtocol";

/** Visual-side score keys used by the player-facing projection. */
export const VIEWER_SCORE_KEY_SELF = "LEFT" as const;
export const VIEWER_SCORE_KEY_OPPONENT = "RIGHT" as const;

export interface ViewerPresentationMessage {
  readonly id: string;
  readonly message: PresentationEnvelope;
}

export interface ViewerPresentation {
  readonly identity: ViewerIdentityContext | null;
  readonly correlation: CorrelationSummary | null;
  readonly messages: ReadonlyArray<ViewerPresentationMessage>;
}

export interface ViewerPresentationInput {
  /** Active protocol instance (`<ROOMCODE>:<INSTANCE>`), or null when unknown. */
  readonly matchInstanceId: string | null;
  /** Raw viewer id — consumed here, never emitted. */
  readonly viewerPlayerId: unknown;
  /** Authoritative `Record<playerId, number>` snapshot. */
  readonly scores: unknown;
  readonly kickerPlayerId?: unknown;
  readonly keeperPlayerId?: unknown;
  /** Authoritative winner id, when the server has declared one. */
  readonly winnerPlayerId?: unknown;
  readonly isDraw?: unknown;
  readonly displayNames?: unknown;
  /** Pending shadow dispatches (id + already-built Protocol v1 envelope). */
  readonly pending: ReadonlyArray<{ readonly id: string; readonly message: unknown }>;
}

const EMPTY: ViewerPresentation = Object.freeze({
  identity: null,
  correlation: null,
  messages: Object.freeze([]) as ReadonlyArray<ViewerPresentationMessage>,
});

/**
 * Project one authoritative `match_state_sync` into the viewer-relative form.
 * Returns null when the envelope is malformed, belongs to another instance, or the
 * projection fails re-validation. Never mutates the source envelope.
 */
export function projectStateSyncForViewer(
  envelope: MatchStateSyncEnvelope,
  identity: ViewerIdentityContext,
): MatchStateSyncEnvelope | null {
  if (envelope.matchInstanceId !== identity.matchInstanceId) return null;
  // Build a NEW payload field-by-field. Scores are the already-authoritative
  // values carried on the identity context — copied, never computed.
  const payload: Record<string, unknown> = {
    scores: {
      [VIEWER_SCORE_KEY_SELF]: identity.self.score,
      [VIEWER_SCORE_KEY_OPPONENT]: identity.opponent.score,
    },
    round: envelope.payload.round,
    maxRounds: envelope.payload.maxRounds,
    phase: envelope.payload.phase,
  };
  if (envelope.payload.suddenDeathRound !== undefined) {
    payload.suddenDeathRound = envelope.payload.suddenDeathRound;
  }
  const candidate: Record<string, unknown> = {
    type: envelope.type,
    protocolVersion: envelope.protocolVersion,
    matchInstanceId: envelope.matchInstanceId,
    sequence: envelope.sequence,
    event: envelope.event,
    payload,
  };
  if (envelope.emittedAt !== undefined) candidate.emittedAt = envelope.emittedAt;

  // Re-validate through the existing validator so the emitted envelope is a
  // freshly-built, contract-conformant Protocol v1 message.
  const validated = validateEnvelope(candidate);
  if (validated === null || validated.event !== "match_state_sync") return null;
  return validated;
}

/** True when `value` contains either raw participant id anywhere. */
function containsRawId(value: string, rawIds: readonly string[]): boolean {
  return rawIds.some((id) => id.length > 0 && value.includes(id));
}

/**
 * Build the sanitized viewer presentation. Pure and total: it never throws, never
 * mutates its inputs, and returns the empty presentation whenever identity cannot
 * be established.
 */
export function buildViewerPresentation(input: ViewerPresentationInput): ViewerPresentation {
  try {
    if (typeof input.matchInstanceId !== "string" || input.matchInstanceId.length === 0) {
      return EMPTY;
    }
    const identityInput = {
      matchInstanceId: input.matchInstanceId,
      viewerPlayerId: typeof input.viewerPlayerId === "string" ? input.viewerPlayerId : "",
      scores: input.scores,
      ...(input.kickerPlayerId !== undefined ? { kickerPlayerId: input.kickerPlayerId } : {}),
      ...(input.keeperPlayerId !== undefined ? { keeperPlayerId: input.keeperPlayerId } : {}),
      ...(input.winnerPlayerId !== undefined ? { winnerPlayerId: input.winnerPlayerId } : {}),
      ...(input.isDraw !== undefined ? { isDraw: input.isDraw } : {}),
      ...(input.displayNames !== undefined ? { displayNames: input.displayNames } : {}),
    };
    const identity = buildViewerIdentityContext(identityInput);
    if (identity === null) return EMPTY;

    // Raw ids are known only inside this function; they never reach the output.
    const rawIds: string[] = [];
    if (typeof input.viewerPlayerId === "string") rawIds.push(input.viewerPlayerId);
    if (input.scores !== null && typeof input.scores === "object" && !Array.isArray(input.scores)) {
      for (const key of Object.keys(input.scores as Record<string, unknown>)) rawIds.push(key);
    }

    const messages: ViewerPresentationMessage[] = [];
    const pending = Array.isArray(input.pending) ? input.pending : [];
    for (const item of pending) {
      if (item === null || typeof item !== "object") continue;
      const validated = validateEnvelope(item.message);
      if (validated === null) continue; // malformed → dropped
      if (validated.matchInstanceId !== identity.matchInstanceId) continue; // foreign → dropped

      let projected: PresentationEnvelope | null = null;
      if (validated.event === "match_state_sync") {
        projected = projectStateSyncForViewer(validated, identity);
      } else {
        // `round_result` carries lanes/result/round only — no player ids.
        projected = validated;
      }
      if (projected === null) continue;

      // Ids are `<instance>:<sequence>:<event>` today (no player id), but a raw id
      // in an id would leak, so fall back to a derived, provably-safe id.
      const rawId = typeof item.id === "string" ? item.id : "";
      const safeId =
        rawId.length > 0 && !containsRawId(rawId, rawIds)
          ? rawId
          : `${projected.matchInstanceId}:${projected.sequence}:${projected.event}`;
      messages.push({ id: safeId, message: projected });
    }

    // Correlation: the most recent valid result → later state-sync pair, if any.
    let correlation: CorrelationSummary | null = null;
    let lastResult: PresentationEnvelope | null = null;
    for (const { message } of messages) {
      if (message.event === "round_result") {
        lastResult = message;
        continue;
      }
      if (lastResult === null) continue;
      const outcome = correlateResultToStateSync(lastResult, message);
      if (outcome.correlated) correlation = outcome.summary;
    }

    return { identity, correlation, messages };
  } catch {
    return EMPTY;
  }
}

/**
 * React convenience wrapper. The logic lives in the pure `buildViewerPresentation`
 * above so it is unit-testable without any React testing dependency.
 */
export function useViewerPresentation(input: ViewerPresentationInput): ViewerPresentation {
  return useMemo(
    () => buildViewerPresentation(input),
    // Recompute when any authoritative input identity changes.
    [
      input.matchInstanceId,
      input.viewerPlayerId,
      input.scores,
      input.kickerPlayerId,
      input.keeperPlayerId,
      input.winnerPlayerId,
      input.isDraw,
      input.displayNames,
      input.pending,
    ],
  );
}
