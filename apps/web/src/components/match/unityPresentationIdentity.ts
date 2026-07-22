/**
 * B6D3A — Viewer-relative identity / visual-side contract (STANDALONE, pure).
 *
 * Solves the B6D3 "player-identity → visual-side" blocker documented in
 * docs/unity-b6d3-player-facing-integration-scope.md §7 as a pure, deterministic,
 * exception-safe TypeScript utility. It is groundwork ONLY:
 *
 *   - It is NOT wired into MatchRoomPanel, MatchRenderer3D, or the shadow path.
 *   - It emits NOTHING to Unity and adds NO postMessage event.
 *   - It does NOT change any serialized Protocol v1 envelope or its wire shape.
 *
 * Inputs MAY contain raw authoritative internal player ids (the React adapter
 * already receives them from `match:update` / `match:result` / `match:end`), but
 * every SANITIZED OUTPUT discards them completely: the output carries only
 * viewer-relative labels (`SELF` / `OPPONENT`), a deterministic visual side, an
 * optional round role, projected numeric scores, an optional authoritative
 * outcome, and an optional bounded display label. No raw id, object key derived
 * from an id, auth token, socket data, or wallet data ever appears in an output.
 *
 * This module NEVER increments, subtracts, compares, or infers scores, and NEVER
 * derives a winner from score values. An outcome is set ONLY when an authoritative
 * source explicitly supplies it. Every function returns a controlled `null`/typed
 * rejection on malformed or hostile input and NEVER throws. It never mutates a
 * source object and never logs raw inputs.
 *
 * See docs/unity-b6d3a-identity-correlation-contract.md. B6D3B is NOT authorized.
 */

import { isValidMatchInstanceId, sanitizeScores } from "./unityPresentationProtocol";

// ── Sanitized output vocabulary (NO raw ids ever) ──────────────────────────────

/** Viewer-relative participant label. Never a raw player id. */
export type ViewerParticipant = "SELF" | "OPPONENT";

/**
 * Deterministic scoreboard side. This is the presentation side of the scoreboard,
 * NOT a shot `Lane` (which is `LEFT | CENTER | RIGHT`). The viewer's own side is
 * always `LEFT`; the opponent is always `RIGHT` (see §6 of the contract doc).
 */
export type VisualSide = "LEFT" | "RIGHT";

/** Round role, viewer-relative once mapped. */
export type RoundRole = "KICKER" | "KEEPER";

/**
 * Authoritative outcome, viewer-relative. Set ONLY from an explicit authoritative
 * source (an authoritative winner id or draw flag) — NEVER derived from scores.
 */
export type OutcomeParticipant = "SELF" | "OPPONENT" | "DRAW";

/** One sanitized participant slot. Contains no raw id. */
export interface ViewerParticipantView {
  participant: ViewerParticipant;
  side: VisualSide;
  /** Authoritative score value copied verbatim from the authoritative map. */
  score: number;
  /** Present only when authoritative kicker/keeper ids were supplied. */
  role?: RoundRole;
  /** Present only when a safe, bounded display label was supplied. */
  displayLabel?: string;
}

/** The full sanitized viewer-relative identity context for one match instance. */
export interface ViewerIdentityContext {
  matchInstanceId: string;
  self: ViewerParticipantView;
  opponent: ViewerParticipantView;
  /** Present only when an authoritative outcome was explicitly supplied. */
  outcome?: OutcomeParticipant;
}

// ── Raw (id-bearing) input contract — ids are consumed, never emitted ───────────

export interface ViewerIdentityInput {
  /** Protocol match-instance id (`<ROOMCODE>:<INSTANCE>`), NOT a player id. */
  matchInstanceId: string;
  /** Raw internal id of the viewing player (input only; discarded from output). */
  viewerPlayerId: string;
  /** Authoritative `Record<playerId, number>` with EXACTLY two valid entries. */
  scores: unknown;
  /** Optional authoritative kicker id; if provided, keeperPlayerId must be too. */
  kickerPlayerId?: unknown;
  /** Optional authoritative keeper id; if provided, kickerPlayerId must be too. */
  keeperPlayerId?: unknown;
  /** Optional AUTHORITATIVE winner id (must be one of the two participants). */
  winnerPlayerId?: unknown;
  /** Optional AUTHORITATIVE draw flag (true → outcome DRAW). */
  isDraw?: unknown;
  /** Optional `Record<playerId, string>` of raw display names (sanitized here). */
  displayNames?: unknown;
}

// ── Display-label sanitizer (optional; never invents a name) ────────────────────

/** Documented maximum length for a sanitized presentation display label. */
export const MAX_DISPLAY_LABEL_LENGTH = 24;

// A UUID (any version) — rejected as an internal identifier, never a display name.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A long bare hex/opaque token — also rejected as an obvious internal id.
const HEX_ID_RE = /^[0-9a-f]{16,}$/i;

/**
 * Sanitize a candidate display label. Returns a bounded, safe string or `null`.
 * NEVER invents a name. Rejects: non-strings; empty/whitespace-only; strings with
 * ASCII control characters; e-mail-like strings (contain `@`); UUIDs; long bare
 * hex tokens; and strings with no alphanumeric character. A safe label is trimmed
 * and truncated to `MAX_DISPLAY_LABEL_LENGTH`. Never throws.
 */
export function sanitizeDisplayLabel(raw: unknown): string | null {
  try {
    if (typeof raw !== "string") return null;
    // Reject any ASCII control char (code < 0x20 or DEL 0x7F) outright.
    for (const ch of raw) {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return null;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    // Reject obvious internal identifiers / contact handles.
    if (trimmed.includes("@")) return null;
    if (UUID_RE.test(trimmed)) return null;
    if (HEX_ID_RE.test(trimmed)) return null;
    // Must contain at least one alphanumeric character to be a display name.
    if (!/[A-Za-z0-9]/.test(trimmed)) return null;
    return trimmed.slice(0, MAX_DISPLAY_LABEL_LENGTH);
  } catch {
    return null;
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

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

/** Optionally resolve a sanitized display label for `playerId` from a names map. */
function resolveDisplayLabel(displayNames: unknown, playerId: string): string | null {
  if (!isPlainRecord(displayNames)) return null;
  // Own-property read only; a hostile getter would throw into the caller's try.
  if (!Object.prototype.hasOwnProperty.call(displayNames, playerId)) return null;
  return sanitizeDisplayLabel(displayNames[playerId]);
}

/**
 * Defence-in-depth: a sanitized label must not CONTAIN either raw participant id
 * (even as a substring), so no internal id can ride into presentation via a name
 * field. The rejected value is never returned or logged — the label is simply
 * omitted. This composes with (never weakens) the generic
 * email/UUID/hex/control-character rejections in `sanitizeDisplayLabel`.
 */
function labelIsFreeOfRawIds(label: string, rawIds: readonly string[]): boolean {
  return !rawIds.some((id) => id.length > 0 && label.includes(id));
}

// ── Public builder ──────────────────────────────────────────────────────────────

/**
 * Build the sanitized viewer-relative identity context, or return `null` on any
 * malformed / ambiguous / hostile input. Deterministic: the SELF/OPPONENT mapping
 * is selected by matching `viewerPlayerId` to a score key, so it does not depend
 * on object key order. The mapping is meaningful only within one `matchInstanceId`
 * (a rematch/new instance is a new context — see §6 of the contract doc).
 *
 * Rules enforced:
 *   - `matchInstanceId` must be a valid protocol instance id.
 *   - `scores` must sanitize (via the protocol `sanitizeScores`) to EXACTLY two
 *     entries (non-empty/trimmed/non-dangerous keys; finite non-negative integer
 *     values). Fewer/more than two → null.
 *   - `viewerPlayerId` must be one of those two keys (missing/unknown → null).
 *   - Roles: if EITHER kicker/keeper id is present, BOTH must be present, distinct,
 *     and be exactly the two participants (any other shape → null).
 *   - `isDraw` shape: `undefined` = absent; `false` = valid, no draw; `true` =
 *     DRAW; any other supplied type → null.
 *   - Outcome: set ONLY from an explicit authoritative source. `isDraw === true`
 *     → DRAW; otherwise a supplied `winnerPlayerId` must be one of the two
 *     participants (unknown → null). A draw flag AND a winner id together → null.
 *     Scores are NEVER compared to derive an outcome.
 *   - Display labels: attached only when they survive `sanitizeDisplayLabel` AND
 *     contain NEITHER raw participant id (an unsafe label is omitted, not fatal).
 *   - Visual side: SELF → LEFT, OPPONENT → RIGHT (deterministic, viewer-relative).
 */
export function buildViewerIdentityContext(
  input: ViewerIdentityInput,
): ViewerIdentityContext | null {
  try {
    if (input === null || typeof input !== "object") return null;
    if (!isValidMatchInstanceId(input.matchInstanceId)) return null;
    if (!isNonEmptyString(input.viewerPlayerId)) return null;

    // Sanitize the authoritative score map into a NEW object (never retains the
    // source; enforces key/value safety incl. prototype-pollution guards).
    const scores = sanitizeScores(input.scores);
    if (scores === null) return null;

    const keys = Object.keys(scores);
    if (keys.length !== 2) return null; // exactly two participants

    const viewerId = input.viewerPlayerId;
    if (!Object.prototype.hasOwnProperty.call(scores, viewerId)) return null; // unknown viewer
    const opponentId = keys[0] === viewerId ? keys[1] : keys[0];
    // Defensive: the two ids must be distinct (object keys are unique, but guard).
    if (opponentId === viewerId) return null;

    // ── Optional round roles (all-or-nothing, must partition the two ids) ──
    let selfRole: RoundRole | undefined;
    let opponentRole: RoundRole | undefined;
    const hasKicker = input.kickerPlayerId !== undefined;
    const hasKeeper = input.keeperPlayerId !== undefined;
    if (hasKicker || hasKeeper) {
      if (!hasKicker || !hasKeeper) return null; // partial roles are malformed
      const kicker = input.kickerPlayerId;
      const keeper = input.keeperPlayerId;
      if (!isNonEmptyString(kicker) || !isNonEmptyString(keeper)) return null;
      if (kicker === keeper) return null; // duplicate players
      const roleIds = new Set([kicker, keeper]);
      if (roleIds.size !== 2) return null;
      if (!roleIds.has(viewerId) || !roleIds.has(opponentId)) return null; // must match participants
      selfRole = kicker === viewerId ? "KICKER" : "KEEPER";
      opponentRole = kicker === opponentId ? "KICKER" : "KEEPER";
    }

    // ── Optional authoritative outcome (NEVER derived from scores) ──
    // `isDraw` shape rule: `undefined` = absent; a boolean is valid (`true` → DRAW,
    // `false` → no draw); ANY other supplied type is malformed → controlled null.
    if (input.isDraw !== undefined && typeof input.isDraw !== "boolean") return null;
    let outcome: OutcomeParticipant | undefined;
    const drawFlag = input.isDraw === true;
    const hasWinner = input.winnerPlayerId !== undefined && input.winnerPlayerId !== null;
    if (drawFlag && hasWinner) return null; // conflicting authoritative outcome
    if (drawFlag) {
      outcome = "DRAW";
    } else if (hasWinner) {
      const winner = input.winnerPlayerId;
      if (!isNonEmptyString(winner)) return null;
      if (winner === viewerId) outcome = "SELF";
      else if (winner === opponentId) outcome = "OPPONENT";
      else return null; // unknown winner id
    }

    // ── Assemble sanitized output (NO raw ids) ──
    const self: ViewerParticipantView = {
      participant: "SELF",
      side: "LEFT",
      score: scores[viewerId],
    };
    const opponent: ViewerParticipantView = {
      participant: "OPPONENT",
      side: "RIGHT",
      score: scores[opponentId],
    };
    if (selfRole !== undefined) self.role = selfRole;
    if (opponentRole !== undefined) opponent.role = opponentRole;

    // A display label is attached only when it survives generic sanitization AND
    // contains NEITHER raw participant id (so no internal id leaks via a name).
    const rawIds: readonly string[] = [viewerId, opponentId];
    const selfLabel = resolveDisplayLabel(input.displayNames, viewerId);
    if (selfLabel !== null && labelIsFreeOfRawIds(selfLabel, rawIds)) {
      self.displayLabel = selfLabel;
    }
    const opponentLabel = resolveDisplayLabel(input.displayNames, opponentId);
    if (opponentLabel !== null && labelIsFreeOfRawIds(opponentLabel, rawIds)) {
      opponent.displayLabel = opponentLabel;
    }

    const context: ViewerIdentityContext = {
      matchInstanceId: input.matchInstanceId,
      self,
      opponent,
    };
    if (outcome !== undefined) context.outcome = outcome;
    return context;
  } catch {
    return null;
  }
}
