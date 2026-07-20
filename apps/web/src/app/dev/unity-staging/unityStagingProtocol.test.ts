/**
 * B6D2B — unit tests for the guarded staging harness protocol helpers.
 * Runs on Node `node:test` via `tsx` (see package.json `test:unity-presentation`,
 * which now also runs this file). No React/DOM.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateUnityAck,
  buildProtocolV1ProofPlan,
  buildStateSyncEnvelope,
  buildRoundResultEnvelope,
  isValidMatchInstanceId,
  REJECT_REASONS,
  MAX_SCORE_ENTRIES,
  type NormalizedAppliedAck,
  type NormalizedRejectedAck,
} from "./unityStagingProtocol";

// ── Fixtures ────────────────────────────────────────────────────────────────
function appliedStateSync(overrides: Record<string, unknown> = {}) {
  return {
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: "ABCD12:1",
      sequence: 1,
      appliedEvent: "match_state_sync",
      round: 1,
      phase: "NORMAL",
      scoreValues: [0, 1],
      playerCount: 2,
      ...overrides,
    },
  };
}

function appliedRoundResult(overrides: Record<string, unknown> = {}) {
  return {
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: "ABCD12:1",
      sequence: 2,
      appliedEvent: "round_result",
      round: 1,
      result: "GOAL",
      ...overrides,
    },
  };
}

function rejected(overrides: Record<string, unknown> = {}) {
  return {
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_rejected",
    payload: {
      protocolVersion: 1,
      matchInstanceId: "ABCD12:1",
      sequence: 3,
      rejectedEvent: "match_state_sync",
      reason: "stale_or_duplicate",
      ...overrides,
    },
  };
}

// ════════════════════════════ VALID ACKS ════════════════════════════════════

test("valid presentation_applied round_result normalizes", () => {
  const r = validateUnityAck(appliedRoundResult()) as NormalizedAppliedAck;
  assert.ok(r);
  assert.equal(r.event, "presentation_applied");
  assert.equal(r.appliedEvent, "round_result");
  assert.equal(r.result, "GOAL");
  assert.equal(r.round, 1);
  assert.equal(r.sequence, 2);
});

test("valid presentation_applied match_state_sync normalizes", () => {
  const r = validateUnityAck(appliedStateSync()) as NormalizedAppliedAck;
  assert.ok(r);
  assert.equal(r.appliedEvent, "match_state_sync");
  assert.deepEqual(r.scoreValues, [0, 1]);
  assert.equal(r.playerCount, 2);
  assert.equal(r.phase, "NORMAL");
});

test("valid presentation_rejected normalizes", () => {
  const r = validateUnityAck(rejected()) as NormalizedRejectedAck;
  assert.ok(r);
  assert.equal(r.event, "presentation_rejected");
  assert.equal(r.reason, "stale_or_duplicate");
  assert.equal(r.sequence, 3);
  assert.equal(r.rejectedEvent, "match_state_sync");
});

test("SUDDEN_DEATH applied state keeps suddenDeathRound", () => {
  const r = validateUnityAck(
    appliedStateSync({ phase: "SUDDEN_DEATH", suddenDeathRound: 2 }),
  ) as NormalizedAppliedAck;
  assert.ok(r);
  assert.equal(r.phase, "SUDDEN_DEATH");
  assert.equal(r.suddenDeathRound, 2);
});

// ════════════════════════════ INVALID ENVELOPES ═════════════════════════════

test("invalid type rejected", () => {
  assert.equal(validateUnityAck({ ...appliedStateSync(), type: "WRONG" }), null);
});

test("unknown event rejected", () => {
  const raw = { ...appliedStateSync(), event: "presentation_unknown" };
  assert.equal(validateUnityAck(raw), null);
});

test("invalid protocolVersion rejected", () => {
  assert.equal(validateUnityAck(appliedStateSync({ protocolVersion: 2 })), null);
  assert.equal(validateUnityAck(rejected({ protocolVersion: 9 })), null);
});

test("invalid matchInstanceId rejected", () => {
  assert.equal(validateUnityAck(appliedStateSync({ matchInstanceId: "abcd12:1" })), null);
  assert.equal(validateUnityAck(appliedStateSync({ matchInstanceId: "ABCD12:0" })), null);
  assert.equal(validateUnityAck(appliedStateSync({ matchInstanceId: "ABCD12" })), null);
});

test("invalid sequence rejected", () => {
  assert.equal(validateUnityAck(appliedStateSync({ sequence: 0 })), null);
  assert.equal(validateUnityAck(appliedStateSync({ sequence: -1 })), null);
  assert.equal(validateUnityAck(appliedStateSync({ sequence: 1.5 })), null);
});

test("invalid appliedEvent rejected", () => {
  assert.equal(validateUnityAck(appliedStateSync({ appliedEvent: "match_end" })), null);
});

test("invalid result rejected", () => {
  assert.equal(validateUnityAck(appliedRoundResult({ result: "WIN" })), null);
});

test("invalid phase rejected", () => {
  assert.equal(validateUnityAck(appliedStateSync({ phase: "OVERTIME" })), null);
});

test("invalid scoreValues rejected", () => {
  assert.equal(validateUnityAck(appliedStateSync({ scoreValues: "nope" })), null);
  assert.equal(validateUnityAck(appliedStateSync({ scoreValues: [] })), null);
});

test("excessive scoreValues rejected", () => {
  const tooMany = Array.from({ length: MAX_SCORE_ENTRIES + 1 }, () => 0);
  assert.equal(
    validateUnityAck(appliedStateSync({ scoreValues: tooMany, playerCount: tooMany.length })),
    null,
  );
});

test("non-integer score rejected", () => {
  assert.equal(validateUnityAck(appliedStateSync({ scoreValues: [1.5, 0] })), null);
  assert.equal(validateUnityAck(appliedStateSync({ scoreValues: [-1, 0] })), null);
});

test("playerCount must equal scoreValues length", () => {
  assert.equal(validateUnityAck(appliedStateSync({ playerCount: 3 })), null);
});

test("round_result ack with a score is rejected", () => {
  assert.equal(validateUnityAck(appliedRoundResult({ scoreValues: [1, 0] })), null);
  assert.equal(validateUnityAck(appliedRoundResult({ playerCount: 2 })), null);
});

test("invalid rejection reason rejected", () => {
  assert.equal(validateUnityAck(rejected({ reason: "because" })), null);
  assert.equal(validateUnityAck(rejected({ reason: "" })), null);
});

// ════════════════════════════ SANITIZATION ══════════════════════════════════

test("extra raw/sensitive fields stripped from normalized output", () => {
  const r = validateUnityAck(
    appliedStateSync({
      authToken: "SECRET",
      wallet: { balance: 5 },
      email: "a@b.c",
      socketId: "xyz",
      username: "hacker",
    }),
  ) as NormalizedAppliedAck;
  assert.ok(r);
  const serialized = JSON.stringify(r);
  for (const bad of ["authToken", "wallet", "email", "socket", "username", "SECRET", "balance"]) {
    assert.ok(!serialized.includes(bad), `normalized output must not contain "${bad}"`);
  }
});

test("no player IDs in normalized acknowledgement", () => {
  const r = validateUnityAck(appliedStateSync()) as NormalizedAppliedAck;
  const serialized = JSON.stringify(r);
  for (const bad of ["p1", "p2", "playerId", "userId"]) {
    assert.ok(!serialized.includes(bad), `normalized output must not contain "${bad}"`);
  }
});

test("exact normalized output keys — applied state sync", () => {
  const r = validateUnityAck(appliedStateSync()) as NormalizedAppliedAck;
  assert.deepEqual(Object.keys(r).sort(), [
    "appliedEvent",
    "event",
    "matchInstanceId",
    "phase",
    "playerCount",
    "protocolVersion",
    "round",
    "scoreValues",
    "sequence",
  ]);
});

test("exact normalized output keys — applied round_result", () => {
  const r = validateUnityAck(appliedRoundResult()) as NormalizedAppliedAck;
  assert.deepEqual(Object.keys(r).sort(), [
    "appliedEvent",
    "event",
    "matchInstanceId",
    "protocolVersion",
    "result",
    "round",
    "sequence",
  ]);
});

test("exact normalized output keys — rejected", () => {
  const r = validateUnityAck(rejected()) as NormalizedRejectedAck;
  assert.deepEqual(Object.keys(r).sort(), [
    "event",
    "matchInstanceId",
    "protocolVersion",
    "reason",
    "rejectedEvent",
    "sequence",
  ]);
});

test("rejected ack with only a reason normalizes (optional fields omitted)", () => {
  const r = validateUnityAck({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_rejected",
    payload: { protocolVersion: 1, reason: "invalid_envelope" },
  }) as NormalizedRejectedAck;
  assert.ok(r);
  assert.deepEqual(Object.keys(r).sort(), ["event", "protocolVersion", "reason"]);
});

test("hostile getters never throw and yield null", () => {
  const hostile = {
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    get payload(): unknown {
      throw new Error("boom");
    },
  };
  assert.equal(validateUnityAck(hostile), null);

  const hostilePayload = {
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      get protocolVersion(): unknown {
        throw new Error("boom");
      },
    },
  };
  assert.equal(validateUnityAck(hostilePayload), null);
});

test("arrays and null are rejected", () => {
  assert.equal(validateUnityAck(null), null);
  assert.equal(validateUnityAck([]), null);
  assert.equal(validateUnityAck("string"), null);
});

// ════════════════════════════ PROOF PLAN ════════════════════════════════════

test("deterministic proof-step ordering", () => {
  const a = buildProtocolV1ProofPlan();
  const b = buildProtocolV1ProofPlan();
  assert.deepEqual(
    a.map((s) => s.id),
    b.map((s) => s.id),
  );
  // ids are strictly increasing from 1.
  a.forEach((s, i) => assert.equal(s.id, i + 1));
  assert.equal(a[0].action, "await-ready");
  assert.ok(a.some((s) => s.action === "reload"));
});

test("proof plan covers required protection scenarios", () => {
  const plan = buildProtocolV1ProofPlan();
  const rejects = plan.filter((s) => s.expect.kind === "rejected");
  const reasons = rejects.map((s) => (s.expect.kind === "rejected" ? s.expect.reason : ""));
  assert.ok(reasons.includes("stale_or_duplicate"));
  assert.ok(reasons.includes("foreign_instance"));
  assert.ok(plan.some((s) => s.expect.kind === "applied" && s.expect.phase === "SUDDEN_DEATH"));
});

test("outbound envelopes are well-formed and match the protocol shape", () => {
  const ss = buildStateSyncEnvelope("ABCD12:1", 1, {
    scores: { p1: 0, p2: 0 },
    round: 1,
    maxRounds: 5,
    phase: "NORMAL",
  });
  assert.equal(ss.type, "PENALTY444_MATCH_EVENT");
  assert.equal(ss.protocolVersion, 1);
  assert.equal(ss.event, "match_state_sync");
  assert.ok(isValidMatchInstanceId(ss.matchInstanceId));

  const rr = buildRoundResultEnvelope("ABCD12:1", 2, {
    round: 1,
    kickerLane: "LEFT",
    keeperLane: "RIGHT",
    result: "GOAL",
  });
  assert.equal(rr.event, "round_result");
  assert.equal(rr.payload.result, "GOAL");
});

test("REJECT_REASONS matches the Unity allowlist exactly", () => {
  assert.deepEqual([...REJECT_REASONS].sort(), [
    "apply_failed",
    "foreign_instance",
    "invalid_envelope",
    "invalid_instance_transition",
    "no_active_instance",
    "stale_or_duplicate",
    "unsupported_version",
  ]);
});
