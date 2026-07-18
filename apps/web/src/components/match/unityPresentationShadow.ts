/**
 * B6D2A — Unity presentation SHADOW coordinator + dispatch queue (pure).
 *
 * Wires the tested B6D1 contract/adapter into the versioned React→Unity shadow
 * path. This module is **pure TypeScript**: no React, no Socket.IO, no Supabase,
 * no browser APIs. It builds authoritative `round_result` / `match_state_sync`
 * envelopes from raw authoritative payloads, owns the protocol match-instance and
 * sequence, provides a FIFO dispatch queue for ordered delivery, and produces
 * SANITIZED audit summaries (never player ids / tokens / wallet / raw payloads).
 *
 * It NEVER computes a gameplay outcome or a score. Every method that consumes an
 * untrusted event payload returns a controlled `null` and never throws.
 *
 * Default-off: the React caller only invokes this when all three public flags
 * (`NEXT_PUBLIC_UNITY_MATCH_ENABLED`, `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED`,
 * `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`) are exactly "true". No Unity C# change;
 * B6D2B / B6D3 unauthorized; production NO-GO.
 */

import {
  deriveMatchInstanceId,
  isPositiveSafeInteger,
  PresentationSequenceEmitter,
  type PresentationEnvelope,
} from "./unityPresentationProtocol";
import {
  buildMatchStateSyncEnvelope,
  buildRoundResultEnvelope,
  buildTerminalStateSyncEnvelope,
  type AdapterBuildOpts,
  type PriorStateSnapshot,
} from "./unityPresentationAdapter";

export type ShadowSource =
  | "match:update"
  | "match:result"
  | "match:end"
  | "ready_resync";

/** Presentation-only audit metadata. Contains NO player ids/tokens/PII/raw data. */
export interface UnityShadowAuditSummary {
  matchInstanceId: string;
  sequence: number;
  event: "round_result" | "match_state_sync";
  source: ShadowSource;
  round?: number;
  phase?: string;
  result?: string;
  /** Sorted numeric score VALUES only — never keyed by player id. */
  scoreValues?: number[];
  playerCount?: number;
  emittedAt?: number;
}

/** A ready-to-transport shadow message: stable id + validated envelope + audit. */
export interface UnityShadowDispatch {
  id: string;
  envelope: PresentationEnvelope;
  audit: UnityShadowAuditSummary;
}

/** Stable message id derived ONLY from the validated envelope. */
export function makeShadowMessageId(envelope: PresentationEnvelope): string {
  return `${envelope.matchInstanceId}:${envelope.sequence}:${envelope.event}`;
}

/** Build a sanitized audit summary from a validated envelope + its source. */
export function buildAuditSummary(
  envelope: PresentationEnvelope,
  source: ShadowSource,
): UnityShadowAuditSummary {
  const summary: UnityShadowAuditSummary = {
    matchInstanceId: envelope.matchInstanceId,
    sequence: envelope.sequence,
    event: envelope.event,
    source,
  };
  if (envelope.emittedAt !== undefined) summary.emittedAt = envelope.emittedAt;
  if (envelope.event === "round_result") {
    summary.round = envelope.payload.round;
    summary.result = envelope.payload.result;
  } else {
    summary.round = envelope.payload.round;
    summary.phase = envelope.payload.phase;
    // Values only — the audit never carries player-id keys.
    const values = Object.values(envelope.payload.scores)
      .filter((v): v is number => typeof v === "number")
      .slice()
      .sort((a, b) => a - b);
    summary.scoreValues = values;
    summary.playerCount = values.length;
  }
  return summary;
}

export type ComparisonResult = "PASS" | "FAIL" | "PENDING";

/**
 * Verify the constructed envelope matches the allowlisted authoritative source
 * fields. NEVER computes a gameplay outcome — it only cross-checks copied fields.
 * Returns PENDING when there is no directly-comparable raw source (terminal
 * `match:end` combines a prior snapshot; `ready_resync` rebuilds from storage).
 */
export function compareEnvelopeToSource(
  envelope: PresentationEnvelope,
  rawSource: unknown,
): ComparisonResult {
  try {
    if (rawSource === null || typeof rawSource !== "object") return "PENDING";
    const src = rawSource as Record<string, unknown>;
    if (envelope.event === "round_result") {
      if (src.result !== envelope.payload.result) return "FAIL";
      if (src.kickerPick !== envelope.payload.kickerLane) return "FAIL";
      if (src.keeperPick !== envelope.payload.keeperLane) return "FAIL";
      if (src.round !== envelope.payload.round) return "FAIL";
      return "PASS";
    }
    // match_state_sync vs a complete match:update snapshot.
    if (src.round !== envelope.payload.round) return "FAIL";
    if (src.maxRounds !== envelope.payload.maxRounds) return "FAIL";
    if (src.phase !== envelope.payload.phase) return "FAIL";
    const srcScores = src.scores;
    if (srcScores === null || typeof srcScores !== "object") return "FAIL";
    const srcVals = Object.values(srcScores as Record<string, unknown>)
      .filter((v): v is number => typeof v === "number")
      .slice()
      .sort((a, b) => a - b);
    const envVals = Object.values(envelope.payload.scores).slice().sort((a, b) => a - b);
    if (srcVals.length !== envVals.length) return "FAIL";
    for (let i = 0; i < srcVals.length; i++) {
      if (srcVals[i] !== envVals[i]) return "FAIL";
    }
    return "PASS";
  } catch {
    return "FAIL";
  }
}

/**
 * Owns the active protocol match-instance, the sequence emitter, and the last
 * successfully-accepted COMPLETE authoritative state snapshot. Never uses React
 * state/refs and never computes a score.
 */
export class UnityPresentationShadowCoordinator {
  private activeInstanceId: string | null = null;
  private readonly emitter = new PresentationSequenceEmitter();
  private priorSnapshot: PriorStateSnapshot | null = null;

  getActiveInstanceId(): string | null {
    return this.activeInstanceId;
  }

  hasPriorSnapshot(): boolean {
    return this.priorSnapshot !== null;
  }

  private optsFor(emittedAt: number | undefined): AdapterBuildOpts {
    const opts: AdapterBuildOpts = {
      matchInstanceId: this.activeInstanceId as string,
      sequence: this.emitter.next(this.activeInstanceId as string),
    };
    if (emittedAt !== undefined) opts.emittedAt = emittedAt;
    return opts;
  }

  private toDispatch(envelope: PresentationEnvelope, source: ShadowSource): UnityShadowDispatch {
    return { id: makeShadowMessageId(envelope), envelope, audit: buildAuditSummary(envelope, source) };
  }

  /**
   * (A) Accept a raw authoritative `match:update`. Derives the protocol instance
   * from roomCode + numeric `matchInstance`; an explicit new instance resets the
   * sequence to 1 and clears the prior snapshot. Builds `match_state_sync`
   * directly from the raw payload and stores ONLY the sanitized envelope payload
   * as the prior complete snapshot. Returns null on malformed data; never throws.
   */
  acceptMatchUpdate(roomCode: unknown, raw: unknown, emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (raw === null || typeof raw !== "object") return null;
      const matchInstance = (raw as Record<string, unknown>).matchInstance;
      if (!isPositiveSafeInteger(matchInstance)) return null;
      const instanceId = deriveMatchInstanceId(roomCode, matchInstance);
      if (instanceId === null) return null;

      // Instance transitions come ONLY from an authoritative match:update.
      if (instanceId !== this.activeInstanceId) {
        this.activeInstanceId = instanceId;
        this.priorSnapshot = null;
      }

      const envelope = buildMatchStateSyncEnvelope(raw, this.optsFor(emittedAt));
      if (envelope === null) return null;

      // Store the sanitized snapshot for later terminal / ready resync.
      this.priorSnapshot = { matchInstanceId: this.activeInstanceId, payload: envelope.payload };
      return this.toDispatch(envelope, "match:update");
    } catch {
      return null;
    }
  }

  /**
   * (B) Accept a raw authoritative `match:result` → `round_result`. Requires an
   * already-established active instance; no scores/phase/maxRounds; no result
   * derivation. Returns null before a valid instance exists; never throws.
   */
  acceptRoundResult(raw: unknown, emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (this.activeInstanceId === null) return null;
      const envelope = buildRoundResultEnvelope(raw, this.optsFor(emittedAt));
      if (envelope === null) return null;
      return this.toDispatch(envelope, "match:result");
    } catch {
      return null;
    }
  }

  /**
   * (C) Accept a raw authoritative `match:end`. Combines ONLY the final
   * authoritative scores with the same-instance stored complete snapshot; returns
   * null when no valid same-instance prior exists (never fabricates
   * round/maxRounds/phase). A later complete `match:update` is the preferred
   * terminal state sync.
   */
  acceptMatchEnd(raw: unknown, emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (this.activeInstanceId === null) return null;
      if (this.priorSnapshot === null) return null;
      if (this.priorSnapshot.matchInstanceId !== this.activeInstanceId) return null;
      const envelope = buildTerminalStateSyncEnvelope(raw, this.priorSnapshot, this.optsFor(emittedAt));
      if (envelope === null) return null;
      return this.toDispatch(envelope, "match:end");
    } catch {
      return null;
    }
  }

  /**
   * (D) On Unity `ready`/reload: rebuild a fresh `match_state_sync` from the last
   * stored sanitized complete snapshot with a NEW sequence. Returns null when no
   * complete snapshot exists. Does NOT replay round_result history.
   */
  buildReadyResync(emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (this.activeInstanceId === null) return null;
      if (this.priorSnapshot === null) return null;
      if (this.priorSnapshot.matchInstanceId !== this.activeInstanceId) return null;
      const envelope = buildMatchStateSyncEnvelope(this.priorSnapshot.payload, this.optsFor(emittedAt));
      if (envelope === null) return null;
      return this.toDispatch(envelope, "ready_resync");
    } catch {
      return null;
    }
  }

  // (F) Raw `match:rejoinState` has no dedicated method: it lacks scores/maxRounds
  // so it can never build a match_state_sync. The caller waits for the complete
  // `match:update` the server also emits on reconnect (documented + tested).
}

// ── FIFO dispatch queue (pure) — used by the renderer for ordered delivery ─────

export interface QueuedShadowMessage {
  id: string;
  /** Legacy `UnityInbound` or a versioned `PresentationEnvelope`. */
  message: unknown;
}

export type EnqueueResult = { ok: true } | { ok: false; reason: "duplicate" | "overflow" };

/**
 * Pure ordered dispatch queue with dedup (by id, across queued + already-sent)
 * and a hard cap. The renderer owns the actual `postMessage`; this only decides
 * ordering/dedup/overflow so it can be unit-tested without React/DOM.
 */
export class ShadowDispatchQueue {
  private queued: QueuedShadowMessage[] = [];
  private readonly queuedIds = new Set<string>();
  private readonly sentIds = new Set<string>();

  constructor(private readonly cap: number = 32) {}

  /** Enqueue in arrival order; reject a duplicate id or a full queue. */
  enqueue(id: string, message: unknown): EnqueueResult {
    if (this.sentIds.has(id) || this.queuedIds.has(id)) return { ok: false, reason: "duplicate" };
    if (this.queued.length >= this.cap) return { ok: false, reason: "overflow" };
    this.queued.push({ id, message });
    this.queuedIds.add(id);
    return { ok: true };
  }

  /** Return all queued messages in FIFO order and mark them sent (clears queue). */
  drain(): QueuedShadowMessage[] {
    const out = this.queued.slice();
    for (const m of out) {
      this.queuedIds.delete(m.id);
      this.sentIds.add(m.id);
    }
    this.queued = [];
    return out;
  }

  hasSent(id: string): boolean {
    return this.sentIds.has(id);
  }

  isQueued(id: string): boolean {
    return this.queuedIds.has(id);
  }

  size(): number {
    return this.queued.length;
  }

  /** Clear queued + queued-id + sent-id state (instance change / iframe reload). */
  reset(): void {
    this.queued = [];
    this.queuedIds.clear();
    this.sentIds.clear();
  }
}

// ── Sanitized "message sent" summary (renderer onMessageSent callback) ─────────

export interface SentSummary {
  messageId: string;
  event: string;
  /** Present ONLY for a validated versioned envelope. */
  matchInstanceId?: string;
  /** Present ONLY for a validated versioned envelope. */
  sequence?: number;
}

/**
 * Build a sanitized sent-summary. A legacy `UnityInbound` yields no invented
 * instance/sequence; a versioned `PresentationEnvelope` yields its validated
 * `matchInstanceId` + `sequence`. Never includes raw payloads. Never throws.
 */
export function summarizeSentMessage(message: unknown, id: string): SentSummary {
  const summary: SentSummary = { messageId: id, event: "unknown" };
  try {
    if (message !== null && typeof message === "object") {
      const m = message as Record<string, unknown>;
      if (typeof m.event === "string") summary.event = m.event;
      if (
        m.protocolVersion === 1 &&
        typeof m.matchInstanceId === "string" &&
        m.matchInstanceId.length > 0 &&
        typeof m.sequence === "number"
      ) {
        summary.matchInstanceId = m.matchInstanceId;
        summary.sequence = m.sequence;
      }
    }
  } catch {
    /* keep safe defaults */
  }
  return summary;
}
