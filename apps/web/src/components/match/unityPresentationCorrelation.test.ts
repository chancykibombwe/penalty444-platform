/**
 * B6D3A — Unit tests for the result-to-state correlation contract. Runs on Node's
 * built-in `node:test` via `tsx` (see package.json `test:unity-presentation`).
 * Pure TypeScript; no Unity, no sockets, no React.
 *
 * Tests assert the CONTRACT: a `round_result` correlates to a strictly-later
 * `match_state_sync` for the SAME instance; the state sync is the only
 * score-bearing event; stale/duplicate/foreign/malformed/swapped inputs are
 * rejected with typed reasons; nothing is derived (no winner, no score delta, no
 * next round, no phase inference); no raw payload/id leaks; nothing ever throws.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTATION_TYPE,
  PRESENTATION_PROTOCOL_VERSION,
} from "./unityPresentationProtocol";
import {
  correlateResultToStateSync,
  isScoreBearingEvent,
} from "./unityPresentationCorrelation";

const INSTANCE = "ABCD12:1";

function roundResult(opts: {
  matchInstanceId?: string;
  sequence: number;
  round?: number;
}) {
  return {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId: opts.matchInstanceId ?? INSTANCE,
    sequence: opts.sequence,
    event: "round_result" as const,
    payload: {
      round: opts.round ?? 1,
      kickerLane: "LEFT" as const,
      keeperLane: "RIGHT" as const,
      result: "GOAL" as const,
    },
  };
}

function stateSync(opts: {
  matchInstanceId?: string;
  sequence: number;
  round?: number;
  scores?: Record<string, number>;
  phase?: "NORMAL" | "SUDDEN_DEATH";
  maxRounds?: number;
  suddenDeathRound?: number;
}) {
  const payload: Record<string, unknown> = {
    scores: opts.scores ?? { p1: 1, p2: 0 },
    round: opts.round ?? 2,
    maxRounds: opts.maxRounds ?? 5,
    phase: opts.phase ?? "NORMAL",
  };
  if (opts.suddenDeathRound !== undefined) payload.suddenDeathRound = opts.suddenDeathRound;
  return {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId: opts.matchInstanceId ?? INSTANCE,
    sequence: opts.sequence,
    event: "match_state_sync" as const,
    payload,
  };
}

// ── Score-bearing invariant ─────────────────────────────────────────────────────

test("only match_state_sync is score-bearing; round_result is not", () => {
  assert.equal(isScoreBearingEvent("match_state_sync"), true);
  assert.equal(isScoreBearingEvent("round_result"), false);
});

// ── Happy path ──────────────────────────────────────────────────────────────────

test("a result followed by a strictly-later state sync correlates", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 2, round: 1 }),
    stateSync({ sequence: 3, round: 2, scores: { p1: 1, p2: 0 } }),
  );
  assert.equal(res.correlated, true);
  assert.ok(res.correlated === true);
  assert.deepStrictEqual(res.summary, {
    matchInstanceId: INSTANCE,
    resultSequence: 2,
    stateSyncSequence: 3,
    resultRound: 1,
    stateSyncRound: 2,
    phase: "NORMAL",
    scoreValues: [0, 1],
  });
});

test("score values come only from the state sync (result carries none)", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 2 }),
    stateSync({ sequence: 3, scores: { p1: 4, p2: 2 } }),
  );
  assert.ok(res.correlated === true);
  // Sorted numeric values from the state sync only; no derivation.
  assert.deepStrictEqual(res.summary.scoreValues, [2, 4]);
});

test("SUDDEN_DEATH snapshot carries phase and suddenDeathRound verbatim", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 5 }),
    stateSync({ sequence: 6, round: 6, phase: "SUDDEN_DEATH", suddenDeathRound: 1, scores: { p1: 5, p2: 5 } }),
  );
  assert.ok(res.correlated === true);
  assert.equal(res.summary.phase, "SUDDEN_DEATH");
  assert.equal(res.summary.suddenDeathRound, 1);
  assert.deepStrictEqual(res.summary.scoreValues, [5, 5]);
});

test("state sync round equal to result round is still accepted (sequence governs)", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 2, round: 3 }),
    stateSync({ sequence: 4, round: 3 }),
  );
  assert.ok(res.correlated === true);
  assert.equal(res.summary.resultRound, 3);
  assert.equal(res.summary.stateSyncRound, 3);
});

// ── Sequence protection ─────────────────────────────────────────────────────────

test("duplicate sequence (state sync == result) → stale-or-duplicate", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 3 }),
    stateSync({ sequence: 3 }),
  );
  assert.equal(res.correlated, false);
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "stale-or-duplicate");
});

test("lower/stale state-sync sequence → stale-or-duplicate", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 5 }),
    stateSync({ sequence: 2 }),
  );
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "stale-or-duplicate");
});

// ── Instance protection / rematch separation ────────────────────────────────────

test("foreign instance (different room) → foreign-instance", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 2, matchInstanceId: "ABCD12:1" }),
    stateSync({ sequence: 3, matchInstanceId: "WXYZ99:1" }),
  );
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "foreign-instance");
});

test("rematch/new-instance state sync cannot correlate to an old-instance result", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 2, matchInstanceId: "ABCD12:1" }),
    stateSync({ sequence: 3, matchInstanceId: "ABCD12:2" }),
  );
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "foreign-instance");
});

// ── Event ordering / wrong types ────────────────────────────────────────────────

test("swapped arguments (state sync as result) → wrong-event-type", () => {
  const res = correlateResultToStateSync(
    stateSync({ sequence: 2 }),
    roundResult({ sequence: 3 }),
  );
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "wrong-event-type");
});

test("two round_results (no state sync) → wrong-event-type", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 2 }),
    roundResult({ sequence: 3 }) as unknown,
  );
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "wrong-event-type");
});

// ── Malformed envelopes ─────────────────────────────────────────────────────────

test("invalid result envelope → invalid-result-envelope", () => {
  const res = correlateResultToStateSync({ nope: true }, stateSync({ sequence: 3 }));
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "invalid-result-envelope");
});

test("invalid state-sync envelope → invalid-state-sync-envelope", () => {
  const bad = { ...stateSync({ sequence: 3 }), protocolVersion: 2 };
  const res = correlateResultToStateSync(roundResult({ sequence: 2 }), bad);
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "invalid-state-sync-envelope");
});

test("a round_result bearing an illegal score field is rejected as invalid", () => {
  // round_result payloads have no score field; validateEnvelope narrows by the
  // allowlisted payload shape, so a score-bearing 'round_result' payload is NOT a
  // valid round_result envelope. (Extra keys on an otherwise-valid payload are
  // ignored by validateEnvelope, so we make the payload structurally invalid.)
  const tainted = {
    ...roundResult({ sequence: 2 }),
    payload: { round: 1, kickerLane: "LEFT", keeperLane: "RIGHT", scores: { p1: 1 } },
  };
  const res = correlateResultToStateSync(tainted, stateSync({ sequence: 3 }));
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "invalid-result-envelope");
});

test("null / non-object inputs → typed rejection, never throws", () => {
  assert.doesNotThrow(() => correlateResultToStateSync(null, null));
  const res = correlateResultToStateSync(null, null);
  assert.ok(res.correlated === false);
  assert.equal(res.reason, "invalid-result-envelope");
});

test("a hostile throwing getter never throws → typed rejection", () => {
  const hostile: Record<string, unknown> = {};
  Object.defineProperty(hostile, "event", {
    get() {
      throw new Error("hostile");
    },
  });
  assert.doesNotThrow(() => correlateResultToStateSync(hostile, stateSync({ sequence: 3 })));
  const res = correlateResultToStateSync(hostile, stateSync({ sequence: 3 }));
  assert.ok(res.correlated === false);
});

// ── Privacy: no derivation, no raw ids ──────────────────────────────────────────

test("summary derives no winner/score-delta/round and leaks no player id", () => {
  const res = correlateResultToStateSync(
    roundResult({ sequence: 2, round: 1 }),
    stateSync({ sequence: 3, round: 2, scores: { "player-self-uuid": 2, "player-opp-uuid": 1 } }),
  );
  assert.ok(res.correlated === true);
  const serialized = JSON.stringify(res.summary);
  assert.ok(!serialized.includes("player-self-uuid"));
  assert.ok(!serialized.includes("player-opp-uuid"));
  // No winner / delta / computed-next-round fields exist on the summary.
  const keys = Object.keys(res.summary).sort();
  assert.deepStrictEqual(keys, [
    "matchInstanceId",
    "phase",
    "resultRound",
    "resultSequence",
    "scoreValues",
    "stateSyncRound",
    "stateSyncSequence",
  ]);
});
