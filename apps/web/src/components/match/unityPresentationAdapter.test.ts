/**
 * B6D1 — Unit tests for the versioned Unity presentation protocol + sanitizing
 * adapter. Runs on Node's built-in `node:test` via `tsx` (see package.json
 * `test:unity-presentation`). Pure TypeScript; no Unity, no sockets, no React.
 *
 * Tests assert EXACT output keys (via deepStrictEqual), the result/state split,
 * sanitization (no auth/Supabase/socket/wallet leakage, no prototype pollution),
 * sequence/instance ordering, and that every function fails to a controlled
 * null and never throws on malformed input.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTATION_TYPE,
  PRESENTATION_PROTOCOL_VERSION,
  validateEnvelope,
  deriveMatchInstanceId,
  normalizeStatusMessage,
  sanitizeScores,
  PresentationSequenceEmitter,
  PresentationSequenceGate,
} from "./unityPresentationProtocol";
import {
  buildRoundResultEnvelope,
  buildMatchStateSyncEnvelope,
  buildTerminalStateSyncEnvelope,
  type PriorStateSnapshot,
} from "./unityPresentationAdapter";

const OPTS = { matchInstanceId: "ABCD12:1", sequence: 1 } as const;

function rrEnvelope(matchInstanceId: string, sequence: number) {
  return {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId,
    sequence,
    event: "round_result" as const,
    payload: { round: 1, kickerLane: "LEFT", keeperLane: "RIGHT", result: "GOAL" },
  };
}

// The junk values every builder/validator must reject to a controlled null.
const JUNK: unknown[] = [
  null,
  undefined,
  0,
  1,
  "string",
  true,
  [],
  [1, 2, 3],
  () => "fn",
  NaN,
  Infinity,
];

// ════════════════════════════════ CONTRACT & ENVELOPE ════════════════════════

test("envelope: valid protocolVersion 1 envelope validates with exact keys", () => {
  const env = {
    type: PRESENTATION_TYPE,
    protocolVersion: 1,
    matchInstanceId: "ABCD12:1",
    sequence: 3,
    emittedAt: 1730000000000,
    event: "round_result",
    payload: { round: 2, kickerLane: "LEFT", keeperLane: "CENTER", result: "SAVE" },
  };
  const out = validateEnvelope(env);
  assert.deepStrictEqual(out, {
    type: "PENALTY444_MATCH_EVENT",
    protocolVersion: 1,
    matchInstanceId: "ABCD12:1",
    sequence: 3,
    emittedAt: 1730000000000,
    event: "round_result",
    payload: { round: 2, kickerLane: "LEFT", keeperLane: "CENTER", result: "SAVE" },
  });
});

test("envelope: invalid protocol version is rejected", () => {
  assert.equal(validateEnvelope({ ...rrEnvelope("ABCD12:1", 1), protocolVersion: 2 }), null);
  assert.equal(validateEnvelope({ ...rrEnvelope("ABCD12:1", 1), protocolVersion: "1" }), null);
});

test("envelope: empty matchInstanceId is rejected", () => {
  assert.equal(validateEnvelope({ ...rrEnvelope("", 1) }), null);
  assert.equal(validateEnvelope({ ...rrEnvelope("   ", 1) }), null);
});

test("envelope: invalid sequence is rejected", () => {
  for (const s of [0, -1, 1.5, NaN, Infinity, "1", null]) {
    assert.equal(validateEnvelope({ ...rrEnvelope("ABCD12:1", 1), sequence: s }), null, `seq=${String(s)}`);
  }
});

test("envelope: invalid emittedAt (when present) is rejected; valid is accepted", () => {
  for (const e of [-1, 1.5, NaN, Infinity, "0"]) {
    assert.equal(validateEnvelope({ ...rrEnvelope("ABCD12:1", 1), emittedAt: e }), null, `emittedAt=${String(e)}`);
  }
  const ok = validateEnvelope({ ...rrEnvelope("ABCD12:1", 1), emittedAt: 0 });
  assert.ok(ok && ok.emittedAt === 0);
});

test("envelope: unknown event is rejected", () => {
  assert.equal(validateEnvelope({ ...rrEnvelope("ABCD12:1", 1), event: "hack" }), null);
});

test("identifier: deterministic roomCode + matchInstance", () => {
  assert.equal(deriveMatchInstanceId("ABCD12", 3), "ABCD12:3");
  assert.equal(deriveMatchInstanceId("  abcd12  ", 3), "ABCD12:3"); // trimmed + uppercased
  assert.equal(deriveMatchInstanceId("Ab12Cd", 1), "AB12CD:1");
});

test("identifier: malformed input returns null and never throws", () => {
  assert.equal(deriveMatchInstanceId("", 1), null);
  assert.equal(deriveMatchInstanceId("   ", 1), null);
  assert.equal(deriveMatchInstanceId("ab cd", 1), null); // whitespace inside
  assert.equal(deriveMatchInstanceId("ab:cd", 1), null); // delimiter injection
  assert.equal(deriveMatchInstanceId("abcd", 0), null);
  assert.equal(deriveMatchInstanceId("abcd", -3), null);
  assert.equal(deriveMatchInstanceId("abcd", 1.5), null);
  assert.equal(deriveMatchInstanceId(123 as unknown as string, 1), null);
  assert.equal(deriveMatchInstanceId("abcd", "3" as unknown as number), null);
});

test("sequence emitter: starts at 1 and resets on new instance", () => {
  const e = new PresentationSequenceEmitter();
  assert.equal(e.next("A:1"), 1);
  assert.equal(e.next("A:1"), 2);
  assert.equal(e.next("A:1"), 3);
  assert.equal(e.next("B:2"), 1); // new instance resets
  assert.equal(e.next("B:2"), 2);
});

test("sequence gate: requires an explicit active instance first", () => {
  const g = new PresentationSequenceGate();
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 1)), { accepted: false, reason: "no-active-instance" });
  g.beginInstance("A:1");
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 1)), { accepted: true });
});

test("sequence gate: duplicate sequence rejected", () => {
  const g = new PresentationSequenceGate();
  g.beginInstance("A:1");
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 1)), { accepted: true });
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 1)), { accepted: false, reason: "stale-or-duplicate" });
});

test("sequence gate: stale/lower sequence rejected", () => {
  const g = new PresentationSequenceGate();
  g.beginInstance("A:1");
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 5)), { accepted: true });
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 4)), { accepted: false, reason: "stale-or-duplicate" });
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 6)), { accepted: true });
});

test("sequence gate: foreign / previous instance rejected after instance change", () => {
  const g = new PresentationSequenceGate();
  g.beginInstance("A:1");
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 1)), { accepted: true });
  // A message from another instance is rejected (not silently adopted).
  assert.deepStrictEqual(g.accept(rrEnvelope("B:2", 9)), { accepted: false, reason: "foreign-instance" });
  // Explicit instance change resets the sequence floor.
  g.beginInstance("B:2");
  assert.deepStrictEqual(g.accept(rrEnvelope("B:2", 1)), { accepted: true });
  // The old instance is now foreign.
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 99)), { accepted: false, reason: "foreign-instance" });
});

test("sequence gate: invalid envelope rejected", () => {
  const g = new PresentationSequenceGate();
  g.beginInstance("A:1");
  assert.deepStrictEqual(g.accept({}), { accepted: false, reason: "invalid-envelope" });
});

// ════════════════════════════════ ROUND RESULT ═══════════════════════════════

test("round_result: valid GOAL builds exact envelope", () => {
  const env = buildRoundResultEnvelope(
    { round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL", statusMessage: "Goal!" },
    OPTS,
  );
  assert.deepStrictEqual(env, {
    type: "PENALTY444_MATCH_EVENT",
    protocolVersion: 1,
    matchInstanceId: "ABCD12:1",
    sequence: 1,
    event: "round_result",
    payload: { round: 1, kickerLane: "LEFT", keeperLane: "RIGHT", result: "GOAL", statusMessage: "Goal!" },
  });
});

test("round_result: valid SAVE and DRAW", () => {
  const save = buildRoundResultEnvelope({ round: 2, kickerPick: "CENTER", keeperPick: "CENTER", result: "SAVE" }, OPTS);
  assert.equal(save?.payload.result, "SAVE");
  const draw = buildRoundResultEnvelope({ round: 3, kickerPick: "LEFT", keeperPick: "RIGHT", result: "DRAW" }, OPTS);
  assert.equal(draw?.payload.result, "DRAW");
});

test("round_result: maps kickerPick→kickerLane and keeperPick→keeperLane", () => {
  const env = buildRoundResultEnvelope({ round: 1, kickerPick: "LEFT", keeperPick: "CENTER", result: "GOAL" }, OPTS);
  assert.equal(env?.payload.kickerLane, "LEFT");
  assert.equal(env?.payload.keeperLane, "CENTER");
});

test("round_result: output carries NO scores / phase / maxRounds (exact keys)", () => {
  const env = buildRoundResultEnvelope(
    { round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL" },
    OPTS,
  );
  assert.ok(env);
  assert.deepStrictEqual(Object.keys(env.payload).sort(), ["keeperLane", "kickerLane", "result", "round"]);
  assert.deepStrictEqual(Object.keys(env).sort(), ["event", "matchInstanceId", "payload", "protocolVersion", "sequence", "type"]);
});

test("round_result: invalid lane / result / round / missing field → null", () => {
  assert.equal(buildRoundResultEnvelope({ round: 1, kickerPick: "UP", keeperPick: "RIGHT", result: "GOAL" }, OPTS), null);
  assert.equal(buildRoundResultEnvelope({ round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "WIN" }, OPTS), null);
  assert.equal(buildRoundResultEnvelope({ round: 0, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL" }, OPTS), null);
  assert.equal(buildRoundResultEnvelope({ round: 1, keeperPick: "RIGHT", result: "GOAL" }, OPTS), null); // missing kickerPick
  assert.equal(buildRoundResultEnvelope({ kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL" }, OPTS), null); // missing round
});

test("round_result: statusMessage sanitized/normalized; non-string omitted", () => {
  const env = buildRoundResultEnvelope(
    { round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL", statusMessage: "  Niceshot  " },
    OPTS,
  );
  assert.equal(env?.payload.statusMessage, "Nice shot");
  // Non-string statusMessage → omitted, not a rejection.
  const env2 = buildRoundResultEnvelope(
    { round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL", statusMessage: { evil: true } },
    OPTS,
  );
  assert.ok(env2 && !("statusMessage" in env2.payload));
  // Over-long is capped at 200 chars.
  const long = "x".repeat(500);
  const env3 = buildRoundResultEnvelope(
    { round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL", statusMessage: long },
    OPTS,
  );
  assert.equal(env3?.payload.statusMessage?.length, 200);
});

test("round_result: unknown extra + wallet/auth/socket fields are stripped", () => {
  const env = buildRoundResultEnvelope(
    {
      round: 1,
      kickerPick: "LEFT",
      keeperPick: "RIGHT",
      result: "GOAL",
      // hostile / irrelevant extras that must never leak:
      authToken: "x",
      accessToken: "x",
      refreshToken: "x",
      supabaseToken: "x",
      session: {},
      jwt: "x",
      socket: {},
      socketId: "x",
      cookie: "x",
      wallet: {},
      walletBalance: 100,
      stakeAmount: 5,
      commission: 1,
      payout: 9,
      email: "a@b.c",
      serviceRoleKey: "x",
      authorization: "Bearer x",
      // plus benign extras
      roomCode: "ABCD12",
      statusMessage: "Goal!",
      scores: { p1: 99 },
      phase: "NORMAL",
      maxRounds: 5,
    },
    OPTS,
  );
  assert.ok(env);
  assert.deepStrictEqual(Object.keys(env.payload).sort(), ["keeperLane", "kickerLane", "result", "round", "statusMessage"]);
  const serialized = JSON.stringify(env);
  for (const bad of ["authToken", "accessToken", "refreshToken", "supabaseToken", "jwt", "socketId", "cookie", "wallet", "stakeAmount", "commission", "payout", "email", "serviceRoleKey", "authorization"]) {
    assert.equal(serialized.includes(bad), false, `leaked ${bad}`);
  }
  // scores/phase/maxRounds on the raw result must NOT reach round_result.
  assert.equal("scores" in env.payload, false);
  assert.equal("phase" in env.payload, false);
  assert.equal("maxRounds" in env.payload, false);
});

test("round_result: adapter never derives result or score (uses server result verbatim)", () => {
  // Same-lane would be SAVE under real rules, but the adapter must NOT recompute;
  // it copies the authoritative `result` field exactly.
  const env = buildRoundResultEnvelope({ round: 1, kickerPick: "LEFT", keeperPick: "LEFT", result: "GOAL" }, OPTS);
  assert.equal(env?.payload.result, "GOAL");
  assert.equal("scores" in (env?.payload ?? {}), false);
});

// ════════════════════════════════ MATCH STATE SYNC ═══════════════════════════

const UPDATE_SNAPSHOT = {
  roomCode: "ABCD12",
  scores: { p1: 1, p2: 0 },
  round: 2,
  maxRounds: 3,
  phase: "NORMAL",
  suddenDeathRound: 0,
  matchInstance: 1,
  // extras that must be stripped:
  authToken: "x",
  wallet: { balance: 5 },
  isResolving: false,
};

test("state_sync: valid NORMAL snapshot builds exact envelope", () => {
  const env = buildMatchStateSyncEnvelope(UPDATE_SNAPSHOT, OPTS);
  assert.deepStrictEqual(env, {
    type: "PENALTY444_MATCH_EVENT",
    protocolVersion: 1,
    matchInstanceId: "ABCD12:1",
    sequence: 1,
    event: "match_state_sync",
    payload: { scores: { p1: 1, p2: 0 }, round: 2, maxRounds: 3, phase: "NORMAL", suddenDeathRound: 0 },
  });
});

test("state_sync: valid SUDDEN_DEATH snapshot", () => {
  const env = buildMatchStateSyncEnvelope(
    { scores: { p1: 3, p2: 3 }, round: 4, maxRounds: 3, phase: "SUDDEN_DEATH", suddenDeathRound: 1 },
    OPTS,
  );
  assert.equal(env?.payload.phase, "SUDDEN_DEATH");
  assert.equal(env?.payload.suddenDeathRound, 1);
});

test("state_sync: authoritative match:update snapshot accepted (complete)", () => {
  const env = buildMatchStateSyncEnvelope(UPDATE_SNAPSHOT, OPTS);
  assert.ok(env);
  assert.deepStrictEqual(env.payload.scores, { p1: 1, p2: 0 });
});

test("state_sync: raw match:rejoinState (no scores/maxRounds) is rejected (documented limitation)", () => {
  // Exact current rejoinState shape (rooms.ts:464-484) — lacks scores & maxRounds.
  const rejoin = {
    roomCode: "ABCD12",
    myRole: "KICKER",
    myPick: "LEFT",
    opponentHasLocked: true,
    round: 2,
    phase: "NORMAL",
    suddenDeathRound: 0,
    matchInstance: 1,
    matchEnded: false,
    isResolving: false,
    disconnectGrace: { active: false },
  };
  assert.equal(buildMatchStateSyncEnvelope(rejoin, OPTS), null);
});

test("state_sync: scores are cloned, not referenced", () => {
  const scores = { p1: 1, p2: 0 };
  const env = buildMatchStateSyncEnvelope({ scores, round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS);
  assert.ok(env);
  assert.notEqual(env.payload.scores, scores); // different reference
  scores.p1 = 999; // mutate source
  assert.equal(env.payload.scores.p1, 1); // output unaffected
});

test("state_sync: dangerous score keys rejected (prototype pollution guard)", () => {
  const polluted = JSON.parse('{"scores":{"__proto__":9,"p1":1},"round":1,"maxRounds":3,"phase":"NORMAL"}');
  assert.equal(buildMatchStateSyncEnvelope(polluted, OPTS), null);
  assert.equal(buildMatchStateSyncEnvelope({ scores: { constructor: 1 }, round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS), null);
  assert.equal(buildMatchStateSyncEnvelope({ scores: { prototype: 1 }, round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS), null);
  // Ensure Object prototype was not polluted by the parse.
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("state_sync: invalid score values rejected", () => {
  for (const bad of [-1, 1.5, NaN, Infinity, "3", null, {}, []]) {
    assert.equal(
      buildMatchStateSyncEnvelope({ scores: { p1: bad }, round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS),
      null,
      `score=${String(bad)}`,
    );
  }
  // empty player id key rejected
  assert.equal(buildMatchStateSyncEnvelope({ scores: { "": 1 }, round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS), null);
});

test("state_sync: invalid phase / round / maxRounds rejected", () => {
  assert.equal(buildMatchStateSyncEnvelope({ scores: { p1: 1 }, round: 1, maxRounds: 3, phase: "OVERTIME" }, OPTS), null);
  assert.equal(buildMatchStateSyncEnvelope({ scores: { p1: 1 }, round: 0, maxRounds: 3, phase: "NORMAL" }, OPTS), null);
  assert.equal(buildMatchStateSyncEnvelope({ scores: { p1: 1 }, round: 1, maxRounds: 1.5, phase: "NORMAL" }, OPTS), null);
});

test("state_sync: wallet/auth/socket fields on the raw snapshot are stripped", () => {
  const env = buildMatchStateSyncEnvelope(UPDATE_SNAPSHOT, OPTS);
  assert.ok(env);
  assert.deepStrictEqual(Object.keys(env.payload).sort(), ["maxRounds", "phase", "round", "scores", "suddenDeathRound"]);
  // Scope the leak check to the PAYLOAD — the envelope's own `matchInstanceId`
  // legitimately contains the substring "matchInstance".
  const payloadJson = JSON.stringify(env.payload);
  for (const bad of ["authToken", "wallet", "isResolving", "roomCode", "matchInstance"]) {
    assert.equal(payloadJson.includes(bad), false, `leaked ${bad}`);
  }
});

// ── correlation / ordering (round_result vs match_state_sync) ─────────────────

test("correlation: result with NO following state update → round_result carries no score, scoreboard unchanged", () => {
  const rr = buildRoundResultEnvelope({ round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL" }, OPTS);
  assert.ok(rr);
  assert.equal("scores" in rr.payload, false); // no score is presented without a state_sync
});

test("correlation: state before AND after round_result both accept in sequence order", () => {
  const g = new PresentationSequenceGate();
  g.beginInstance("ABCD12:1");
  const preState = buildMatchStateSyncEnvelope({ scores: { p1: 0, p2: 0 }, round: 1, maxRounds: 3, phase: "NORMAL" }, { matchInstanceId: "ABCD12:1", sequence: 1 });
  const result = buildRoundResultEnvelope({ round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL" }, { matchInstanceId: "ABCD12:1", sequence: 2 });
  const postState = buildMatchStateSyncEnvelope({ scores: { p1: 1, p2: 0 }, round: 2, maxRounds: 3, phase: "NORMAL" }, { matchInstanceId: "ABCD12:1", sequence: 3 });
  assert.deepStrictEqual(g.accept(preState), { accepted: true });
  assert.deepStrictEqual(g.accept(result), { accepted: true });
  assert.deepStrictEqual(g.accept(postState), { accepted: true });
});

test("correlation: duplicate state snapshot rejected by gate", () => {
  const g = new PresentationSequenceGate();
  g.beginInstance("ABCD12:1");
  const s = buildMatchStateSyncEnvelope({ scores: { p1: 1 }, round: 1, maxRounds: 3, phase: "NORMAL" }, { matchInstanceId: "ABCD12:1", sequence: 4 });
  assert.deepStrictEqual(g.accept(s), { accepted: true });
  assert.deepStrictEqual(g.accept(s), { accepted: false, reason: "stale-or-duplicate" });
});

test("correlation: stale pre-result score snapshot is not relabeled; later score applies", () => {
  // Pre-result snapshot legitimately holds the OLD score; it is authoritative
  // historical state, not a post-result score.
  const pre = buildMatchStateSyncEnvelope({ scores: { p1: 0, p2: 0 }, round: 1, maxRounds: 3, phase: "NORMAL" }, { matchInstanceId: "ABCD12:1", sequence: 1 });
  assert.deepStrictEqual(pre?.payload.scores, { p1: 0, p2: 0 });
  // A later authoritative snapshot carries the server's updated score.
  const post = buildMatchStateSyncEnvelope({ scores: { p1: 1, p2: 0 }, round: 2, maxRounds: 3, phase: "NORMAL" }, { matchInstanceId: "ABCD12:1", sequence: 2 });
  assert.deepStrictEqual(post?.payload.scores, { p1: 1, p2: 0 });
  // The adapter never inferred the +1 — it copied each authoritative snapshot.
});

test("correlation: reconnect full-state resync from a complete match:update snapshot", () => {
  const resync = buildMatchStateSyncEnvelope({ scores: { p1: 2, p2: 1 }, round: 4, maxRounds: 5, phase: "NORMAL", suddenDeathRound: 0 }, OPTS);
  assert.deepStrictEqual(resync?.payload, { scores: { p1: 2, p2: 1 }, round: 4, maxRounds: 5, phase: "NORMAL", suddenDeathRound: 0 });
});

test("correlation: no local score computation (state_sync copies scores exactly)", () => {
  const env = buildMatchStateSyncEnvelope({ scores: { p1: 2, p2: 2 }, round: 5, maxRounds: 5, phase: "SUDDEN_DEATH", suddenDeathRound: 1 }, OPTS);
  assert.deepStrictEqual(env?.payload.scores, { p1: 2, p2: 2 });
});

// ── terminal match:end ────────────────────────────────────────────────────────

const PRIOR: PriorStateSnapshot = {
  matchInstanceId: "ABCD12:1",
  payload: { scores: { p1: 2, p2: 1 }, round: 3, maxRounds: 3, phase: "NORMAL" },
};

test("terminal: match:end with same-instance complete prior → combined sync", () => {
  const env = buildTerminalStateSyncEnvelope({ scores: { p1: 3, p2: 1 } }, PRIOR, OPTS);
  assert.deepStrictEqual(env, {
    type: "PENALTY444_MATCH_EVENT",
    protocolVersion: 1,
    matchInstanceId: "ABCD12:1",
    sequence: 1,
    event: "match_state_sync",
    // scores from match:end; round/maxRounds/phase from the prior snapshot.
    payload: { scores: { p1: 3, p2: 1 }, round: 3, maxRounds: 3, phase: "NORMAL" },
  });
});

test("terminal: match:end with NO prior snapshot → null (no fabrication)", () => {
  assert.equal(buildTerminalStateSyncEnvelope({ scores: { p1: 3, p2: 1 } }, null, OPTS), null);
});

test("terminal: match:end with FOREIGN-instance prior → null", () => {
  const foreign: PriorStateSnapshot = { ...PRIOR, matchInstanceId: "ZZZZ99:2" };
  assert.equal(buildTerminalStateSyncEnvelope({ scores: { p1: 3, p2: 1 } }, foreign, OPTS), null);
});

test("terminal: match:end scores still sanitized (dangerous keys rejected)", () => {
  const polluted = JSON.parse('{"scores":{"__proto__":1,"p1":3}}');
  assert.equal(buildTerminalStateSyncEnvelope(polluted, PRIOR, OPTS), null);
});

// ════════════════════════════════ SANITIZATION UNITS ═════════════════════════

test("sanitizeScores: valid clone; dangerous/invalid rejected", () => {
  assert.deepStrictEqual(sanitizeScores({ p1: 0, p2: 3 }), { p1: 0, p2: 3 });
  assert.equal(sanitizeScores({ p1: -1 }), null);
  assert.equal(sanitizeScores({ p1: 1.5 }), null);
  assert.equal(sanitizeScores({ "": 1 }), null);
  assert.equal(sanitizeScores(JSON.parse('{"__proto__":1}')), null);
  assert.equal(sanitizeScores(null), null);
  assert.equal(sanitizeScores([1, 2]), null);
});

test("normalizeStatusMessage: trims, strips control chars, caps, empties → null", () => {
  assert.equal(normalizeStatusMessage("  hi  "), "hi");
  assert.equal(normalizeStatusMessage("a b"), "a b");
  assert.equal(normalizeStatusMessage("   "), null);
  assert.equal(normalizeStatusMessage("x".repeat(1000))?.length, 200);
});

// ════════════════════════════════ ROBUSTNESS ═════════════════════════════════

test("robustness: builders return null (never throw) for junk inputs", () => {
  for (const j of JUNK) {
    assert.doesNotThrow(() => buildRoundResultEnvelope(j, OPTS));
    assert.doesNotThrow(() => buildMatchStateSyncEnvelope(j, OPTS));
    assert.doesNotThrow(() => buildTerminalStateSyncEnvelope(j, PRIOR, OPTS));
    assert.doesNotThrow(() => validateEnvelope(j));
    assert.doesNotThrow(() => sanitizeScores(j));
    assert.equal(buildRoundResultEnvelope(j, OPTS), null);
    assert.equal(buildMatchStateSyncEnvelope(j, OPTS), null);
  }
});

test("robustness: invalid build opts → null", () => {
  const raw = { round: 1, kickerPick: "LEFT", keeperPick: "RIGHT", result: "GOAL" };
  assert.equal(buildRoundResultEnvelope(raw, { matchInstanceId: "", sequence: 1 }), null);
  assert.equal(buildRoundResultEnvelope(raw, { matchInstanceId: "A:1", sequence: 0 }), null);
  assert.equal(buildRoundResultEnvelope(raw, { matchInstanceId: "A:1", sequence: 1, emittedAt: -5 }), null);
});

test("robustness: getters that throw do not crash the adapter", () => {
  const evil: Record<string, unknown> = { round: 1, kickerPick: "LEFT", keeperPick: "RIGHT" };
  Object.defineProperty(evil, "result", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  assert.doesNotThrow(() => buildRoundResultEnvelope(evil, OPTS));
  assert.equal(buildRoundResultEnvelope(evil, OPTS), null);

  const evilScores: Record<string, unknown> = {};
  Object.defineProperty(evilScores, "p1", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  assert.doesNotThrow(() => buildMatchStateSyncEnvelope({ scores: evilScores, round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS));
  assert.equal(buildMatchStateSyncEnvelope({ scores: evilScores, round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS), null);
});

// ══════════════════ HOSTILE GETTERS / PROXIES / EXOTIC OBJECTS ════════════════

test("hostile: validateEnvelope with a throwing top-level `type` getter → null, no throw", () => {
  const env: Record<string, unknown> = {
    protocolVersion: 1,
    matchInstanceId: "A:1",
    sequence: 1,
    event: "round_result",
    payload: { round: 1, kickerLane: "LEFT", keeperLane: "RIGHT", result: "GOAL" },
  };
  Object.defineProperty(env, "type", { enumerable: true, get() { throw new Error("boom"); } });
  assert.doesNotThrow(() => validateEnvelope(env));
  assert.equal(validateEnvelope(env), null);
});

test("hostile: validateEnvelope with a throwing `payload` getter → null, no throw", () => {
  const env: Record<string, unknown> = {
    type: PRESENTATION_TYPE,
    protocolVersion: 1,
    matchInstanceId: "A:1",
    sequence: 1,
    event: "round_result",
  };
  Object.defineProperty(env, "payload", { enumerable: true, get() { throw new Error("boom"); } });
  assert.doesNotThrow(() => validateEnvelope(env));
  assert.equal(validateEnvelope(env), null);
});

test("hostile: validateEnvelope with a throwing nested payload-field getter → null, no throw", () => {
  const payload: Record<string, unknown> = { kickerLane: "LEFT", keeperLane: "RIGHT", result: "GOAL" };
  Object.defineProperty(payload, "round", { enumerable: true, get() { throw new Error("boom"); } });
  const env = { type: PRESENTATION_TYPE, protocolVersion: 1, matchInstanceId: "A:1", sequence: 1, event: "round_result", payload };
  assert.doesNotThrow(() => validateEnvelope(env));
  assert.equal(validateEnvelope(env), null);
});

test("hostile: sanitizeScores with a Proxy whose ownKeys trap throws → null, no throw", () => {
  const p = new Proxy({}, { ownKeys() { throw new Error("nope"); } });
  assert.doesNotThrow(() => sanitizeScores(p));
  assert.equal(sanitizeScores(p), null);
});

test("hostile: sanitizeScores with a Proxy whose descriptor trap throws → null, no throw", () => {
  const p = new Proxy({ p1: 1 }, { getOwnPropertyDescriptor() { throw new Error("nope"); } });
  assert.doesNotThrow(() => sanitizeScores(p));
  assert.equal(sanitizeScores(p), null);
});

test("hostile: sanitizeScores with a revoked Proxy → null, no throw", () => {
  const { proxy, revoke } = Proxy.revocable({ p1: 1 }, {});
  revoke();
  assert.doesNotThrow(() => sanitizeScores(proxy));
  assert.equal(sanitizeScores(proxy), null);
});

test("hostile: validateEnvelope containing hostile scores → null, no throw", () => {
  const badScores = new Proxy({}, { ownKeys() { throw new Error("nope"); } });
  const env = {
    type: PRESENTATION_TYPE,
    protocolVersion: 1,
    matchInstanceId: "A:1",
    sequence: 1,
    event: "match_state_sync",
    payload: { scores: badScores, round: 1, maxRounds: 3, phase: "NORMAL" },
  };
  assert.doesNotThrow(() => validateEnvelope(env));
  assert.equal(validateEnvelope(env), null);
});

test("hostile: gate.accept with a hostile envelope → invalid-envelope, no state change, later seq 1 accepted", () => {
  const g = new PresentationSequenceGate();
  g.beginInstance("A:1");
  const hostile: Record<string, unknown> = {
    protocolVersion: 1,
    matchInstanceId: "A:1",
    sequence: 5,
    event: "round_result",
    payload: { round: 1, kickerLane: "LEFT", keeperLane: "RIGHT", result: "GOAL" },
  };
  Object.defineProperty(hostile, "type", { enumerable: true, get() { throw new Error("boom"); } });
  let decision: unknown;
  assert.doesNotThrow(() => {
    decision = g.accept(hostile);
  });
  assert.deepStrictEqual(decision, { accepted: false, reason: "invalid-envelope" });
  assert.equal(g.lastSequence(), 0); // lastSequence not advanced by a rejected hostile envelope
  assert.equal(g.activeInstance(), "A:1"); // instance not silently changed
  // A later valid sequence 1 is still accepted (proving the floor stayed at 0).
  assert.deepStrictEqual(g.accept(rrEnvelope("A:1", 1)), { accepted: true });
});

test("exotic: Date / Map / Set / class instance are rejected as score maps", () => {
  assert.equal(sanitizeScores(new Date()), null);
  assert.equal(sanitizeScores(new Map([["p1", 1]])), null);
  assert.equal(sanitizeScores(new Set([1])), null);
  class Scoreish {
    p1 = 1;
  }
  assert.equal(sanitizeScores(new Scoreish()), null);
  // ... and via the builder
  assert.equal(buildMatchStateSyncEnvelope({ scores: new Map(), round: 1, maxRounds: 3, phase: "NORMAL" }, OPTS), null);
});

test("exotic: Object.create(null) with valid own score entries is accepted and cloned", () => {
  const s = Object.create(null) as Record<string, number>;
  s.p1 = 1;
  s.p2 = 0;
  const cleaned = sanitizeScores(s);
  assert.deepStrictEqual(cleaned, { p1: 1, p2: 0 });
  assert.notEqual(cleaned, s); // fresh clone, not the source reference
});

test("score keys: whitespace-only player id is rejected", () => {
  assert.equal(sanitizeScores({ "   ": 1 }), null);
  assert.equal(sanitizeScores({ "\t": 1 }), null);
});

test("score keys: player id with leading/trailing whitespace is rejected", () => {
  assert.equal(sanitizeScores({ " p1": 1 }), null);
  assert.equal(sanitizeScores({ "p1 ": 1 }), null);
  assert.equal(sanitizeScores({ " p1 ": 1 }), null);
});
