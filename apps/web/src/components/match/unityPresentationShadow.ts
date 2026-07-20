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
  sanitizeScores,
  validateEnvelope,
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
    // match_state_sync vs a complete match:update snapshot. EXACT keyed check:
    // the player-id key SET and each keyed score must match (so a swapped
    // player→score assignment FAILs), plus round/maxRounds/phase and the
    // suddenDeathRound presence+value. Keys are compared internally only; the
    // audit summary still exposes no player ids.
    if (src.round !== envelope.payload.round) return "FAIL";
    if (src.maxRounds !== envelope.payload.maxRounds) return "FAIL";
    if (src.phase !== envelope.payload.phase) return "FAIL";
    const envHasSD = envelope.payload.suddenDeathRound !== undefined;
    const srcHasSD = src.suddenDeathRound !== undefined;
    if (envHasSD !== srcHasSD) return "FAIL";
    if (envHasSD && src.suddenDeathRound !== envelope.payload.suddenDeathRound) return "FAIL";
    const srcScores = sanitizeScores(src.scores);
    if (srcScores === null) return "FAIL";
    const envScores = envelope.payload.scores;
    const envKeys = Object.keys(envScores).sort();
    const srcKeys = Object.keys(srcScores).sort();
    if (envKeys.length !== srcKeys.length) return "FAIL";
    for (let i = 0; i < envKeys.length; i++) {
      if (envKeys[i] !== srcKeys[i]) return "FAIL"; // exact key set
    }
    for (const k of envKeys) {
      if (envScores[k] !== srcScores[k]) return "FAIL"; // swapped assignment → FAIL
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
  // Mirror of the last COMMITTED sequence for the active instance (0 = none). Lets
  // us build provisionally with a candidate sequence and only advance the emitter
  // on a successful (validated) build — so a malformed payload never consumes a
  // sequence or mutates instance state.
  private committedSeq = 0;

  getActiveInstanceId(): string | null {
    return this.activeInstanceId;
  }

  hasPriorSnapshot(): boolean {
    return this.priorSnapshot !== null;
  }

  // The sequence a message for `instanceId` WOULD receive — without mutating.
  private peekSequence(instanceId: string): number {
    return instanceId === this.activeInstanceId ? this.committedSeq + 1 : 1;
  }

  // Commit atomically: on a new instance, switch active + clear prior + reset the
  // sequence; then advance the emitter (which returns the peeked value) and record
  // it. Called ONLY after a successful build.
  private commit(instanceId: string, isNewInstance: boolean): void {
    if (isNewInstance) {
      this.activeInstanceId = instanceId;
      this.priorSnapshot = null;
      this.committedSeq = 0;
    }
    this.committedSeq = this.emitter.next(instanceId);
  }

  private optsFor(instanceId: string, sequence: number, emittedAt: number | undefined): AdapterBuildOpts {
    const opts: AdapterBuildOpts = { matchInstanceId: instanceId, sequence };
    if (emittedAt !== undefined) opts.emittedAt = emittedAt;
    return opts;
  }

  private toDispatch(envelope: PresentationEnvelope, source: ShadowSource): UnityShadowDispatch {
    return { id: makeShadowMessageId(envelope), envelope, audit: buildAuditSummary(envelope, source) };
  }

  /**
   * (A) Accept a raw authoritative `match:update`. Derives the candidate instance
   * from roomCode + numeric `matchInstance`, then **validates the complete state
   * FIRST**. Only on success does it commit atomically: switch to a new instance
   * (reset sequence to 1, clear prior), advance the sequence, and replace the
   * prior snapshot. A validation failure changes NOTHING (no instance change, no
   * prior clear, no sequence consumed) and returns null. Never throws.
   */
  acceptMatchUpdate(roomCode: unknown, raw: unknown, emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (raw === null || typeof raw !== "object") return null;
      const matchInstance = (raw as Record<string, unknown>).matchInstance;
      if (!isPositiveSafeInteger(matchInstance)) return null;
      const instanceId = deriveMatchInstanceId(roomCode, matchInstance);
      if (instanceId === null) return null;

      const isNewInstance = instanceId !== this.activeInstanceId;
      const candidateSeq = this.peekSequence(instanceId);
      const envelope = buildMatchStateSyncEnvelope(
        raw,
        this.optsFor(instanceId, candidateSeq, emittedAt)
      );
      if (envelope === null) return null; // atomic: nothing mutated on failure

      this.commit(instanceId, isNewInstance);
      this.priorSnapshot = { matchInstanceId: instanceId, payload: envelope.payload };
      return this.toDispatch(envelope, "match:update");
    } catch {
      return null;
    }
  }

  /**
   * (B) Accept a raw authoritative `match:result` → `round_result`. Requires an
   * already-established active instance; no scores/phase/maxRounds; no result
   * derivation. A malformed result consumes NO sequence. Null before a valid
   * instance exists; never throws.
   */
  acceptRoundResult(raw: unknown, emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (this.activeInstanceId === null) return null;
      const candidateSeq = this.peekSequence(this.activeInstanceId);
      const envelope = buildRoundResultEnvelope(
        raw,
        this.optsFor(this.activeInstanceId, candidateSeq, emittedAt)
      );
      if (envelope === null) return null; // no sequence consumed on failure
      this.commit(this.activeInstanceId, false);
      return this.toDispatch(envelope, "match:result");
    } catch {
      return null;
    }
  }

  /**
   * (C) Accept a raw authoritative `match:end`. Combines ONLY the final
   * authoritative scores with the same-instance stored complete snapshot; returns
   * null when no valid same-instance prior exists (never fabricates
   * round/maxRounds/phase) and consumes NO sequence on failure. A later complete
   * `match:update` is the preferred terminal state sync.
   */
  acceptMatchEnd(raw: unknown, emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (this.activeInstanceId === null) return null;
      if (this.priorSnapshot === null) return null;
      if (this.priorSnapshot.matchInstanceId !== this.activeInstanceId) return null;
      const candidateSeq = this.peekSequence(this.activeInstanceId);
      const envelope = buildTerminalStateSyncEnvelope(
        raw,
        this.priorSnapshot,
        this.optsFor(this.activeInstanceId, candidateSeq, emittedAt)
      );
      if (envelope === null) return null; // no sequence consumed on failure
      this.commit(this.activeInstanceId, false);
      return this.toDispatch(envelope, "match:end");
    } catch {
      return null;
    }
  }

  /**
   * (D) On Unity `ready`/reload: rebuild a fresh `match_state_sync` from the last
   * stored sanitized complete snapshot with a NEW sequence. Returns null (and
   * consumes NO sequence) when no complete snapshot exists. Does NOT replay
   * round_result history.
   */
  buildReadyResync(emittedAt?: number): UnityShadowDispatch | null {
    try {
      if (this.activeInstanceId === null) return null;
      if (this.priorSnapshot === null) return null;
      if (this.priorSnapshot.matchInstanceId !== this.activeInstanceId) return null;
      const candidateSeq = this.peekSequence(this.activeInstanceId);
      const envelope = buildMatchStateSyncEnvelope(
        this.priorSnapshot.payload,
        this.optsFor(this.activeInstanceId, candidateSeq, emittedAt)
      );
      if (envelope === null) return null; // no sequence consumed on failure
      this.commit(this.activeInstanceId, false);
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

// Known event names that may appear as a sanitized `event` label (legacy or
// versioned). Anything else becomes "unknown".
const KNOWN_EVENTS = new Set([
  "round_result",
  "match_state_sync",
  "staging_begin",
  "match_end",
  "reset",
]);

/**
 * Build a sanitized sent-summary. Only a **fully-validated** B6D1
 * `PresentationEnvelope` (via `validateEnvelope`) may contribute `matchInstanceId`
 * + `sequence` + the versioned event. A malformed "versioned-looking" object
 * (bad protocol version, invalid/negative sequence, malformed payload) receives
 * NO invented instance/sequence. Legacy messages keep only a sanitized known
 * event name. Never includes raw payloads; never throws.
 */
export function summarizeSentMessage(message: unknown, id: string): SentSummary {
  const summary: SentSummary = { messageId: id, event: "unknown" };
  try {
    const validated = validateEnvelope(message);
    if (validated !== null) {
      summary.event = validated.event;
      summary.matchInstanceId = validated.matchInstanceId;
      summary.sequence = validated.sequence;
      return summary;
    }
    // Legacy / unvalidatable: a sanitized known event name only — never an
    // invented instance or sequence.
    if (message !== null && typeof message === "object") {
      const ev = (message as Record<string, unknown>).event;
      if (typeof ev === "string" && KNOWN_EVENTS.has(ev)) summary.event = ev;
    }
  } catch {
    /* keep safe defaults */
  }
  return summary;
}

// ── Parent-side pending-unsent buffer helpers (pure) ───────────────────────────
// The MatchRoomPanel keeps only UNSENT versioned dispatches (not replayable
// history). Sent messages are removed on acknowledgment; an instance change or a
// ready lifecycle replaces the buffer; a 33rd unsent message is an explicit
// overflow (never a silent trim). These are pure so the lifecycle is unit-tested
// without React/DOM.

export const SHADOW_PENDING_CAP = 32;

export interface PendingShadowItem {
  id: string;
  message: PresentationEnvelope;
}

export interface PendingAppendResult {
  buffer: PendingShadowItem[];
  overflow: boolean;
}

/**
 * Append an unsent dispatch in creation order. Deduplicates by id. When the
 * buffer already holds SHADOW_PENDING_CAP (32) unsent messages, the next one is an
 * explicit OVERFLOW: the buffer is bounded at CAP+1 (so the renderer can detect
 * failure) and never grows beyond it, and the OLDEST is never trimmed.
 */
export function appendPending(
  buffer: readonly PendingShadowItem[],
  item: PendingShadowItem,
): PendingAppendResult {
  if (buffer.some((m) => m.id === item.id)) {
    return { buffer: buffer.slice(), overflow: false }; // dedup
  }
  if (buffer.length >= SHADOW_PENDING_CAP) {
    if (buffer.length > SHADOW_PENDING_CAP) {
      return { buffer: buffer.slice(), overflow: true }; // already overflowed — do not grow
    }
    return { buffer: [...buffer, item], overflow: true }; // the 33rd → overflow
  }
  return { buffer: [...buffer, item], overflow: false };
}

/** Remove a transported message once its id is acknowledged (onMessageSent). */
export function acknowledgePending(
  buffer: readonly PendingShadowItem[],
  messageId: string,
): PendingShadowItem[] {
  return buffer.filter((m) => m.id !== messageId);
}

/**
 * Replace the buffer for a fresh lifecycle (new instance, or a ready resync):
 * drop ALL prior history and keep only the single new item (or none).
 */
export function replacePending(item: PendingShadowItem | null): PendingShadowItem[] {
  return item === null ? [] : [item];
}

/** Keep only items belonging to the given active instance (defensive isolation). */
export function pendingForInstance(
  buffer: readonly PendingShadowItem[],
  activeInstanceId: string | null,
): PendingShadowItem[] {
  if (activeInstanceId === null) return [];
  return buffer.filter((m) => m.message.matchInstanceId === activeInstanceId);
}

/**
 * Renderer guard: does a queued message VALIDATE as a versioned envelope for the
 * active instance? A foreign-instance or unvalidatable message is rejected.
 */
export function isEnvelopeForActiveInstance(
  message: unknown,
  activeInstanceId: string | null,
): boolean {
  if (activeInstanceId === null) return false;
  const v = validateEnvelope(message);
  return v !== null && v.matchInstanceId === activeInstanceId;
}
