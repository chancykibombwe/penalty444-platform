/**
 * B6D2A — unit tests for the pure shadow coordinator + dispatch queue.
 * Runs on Node `node:test` via `tsx` (see package.json `test:unity-presentation`,
 * which now runs both this and unityPresentationAdapter.test.ts). No React/DOM.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  UnityPresentationShadowCoordinator,
  ShadowDispatchQueue,
  makeShadowMessageId,
  buildAuditSummary,
  compareEnvelopeToSource,
  summarizeSentMessage,
} from "./unityPresentationShadow";

function freshUpdate(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCD12",
    scores: { p1: 1, p2: 0 },
    round: 2,
    maxRounds: 3,
    phase: "NORMAL",
    suddenDeathRound: 0,
    matchInstance: 1,
    // sensitive/extra that must be stripped:
    authToken: "SECRET",
    wallet: { balance: 5 },
    isResolving: false,
    ...overrides,
  };
}

const RESULT_RAW = {
  roomCode: "ABCD12",
  round: 1,
  kickerPick: "LEFT",
  keeperPick: "RIGHT",
  result: "GOAL",
  statusMessage: "Goal!",
  scores: { p1: 99 }, // must be ignored by round_result
  authToken: "SECRET",
};

// ════════════════════════════════ COORDINATOR ════════════════════════════════

test("coordinator: valid first match:update establishes instance + sequence 1 state sync", () => {
  const c = new UnityPresentationShadowCoordinator();
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate());
  assert.ok(d);
  assert.equal(d.envelope.event, "match_state_sync");
  assert.equal(d.envelope.matchInstanceId, "ABCD12:1");
  assert.equal(d.envelope.sequence, 1);
  assert.equal(c.getActiveInstanceId(), "ABCD12:1");
});

test("coordinator: invalid/missing matchInstance emits nothing", () => {
  const c = new UnityPresentationShadowCoordinator();
  for (const mi of [undefined, 0, -1, 1.5, "1", null]) {
    assert.equal(c.acceptMatchUpdate("ABCD12", freshUpdate({ matchInstance: mi })), null, `matchInstance=${String(mi)}`);
  }
  assert.equal(c.getActiveInstanceId(), null); // never established
});

test("coordinator: result before an active instance emits nothing", () => {
  const c = new UnityPresentationShadowCoordinator();
  assert.equal(c.acceptRoundResult(RESULT_RAW), null);
});

test("coordinator: result after state gets the next sequence", () => {
  const c = new UnityPresentationShadowCoordinator();
  assert.equal(c.acceptMatchUpdate("ABCD12", freshUpdate())?.envelope.sequence, 1);
  const r = c.acceptRoundResult(RESULT_RAW);
  assert.equal(r?.envelope.sequence, 2);
  assert.equal(r?.envelope.event, "round_result");
});

test("coordinator: round_result carries no scores/phase/maxRounds (exact keys)", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate());
  const r = c.acceptRoundResult(RESULT_RAW);
  assert.ok(r && r.envelope.event === "round_result");
  assert.deepStrictEqual(Object.keys(r.envelope.payload).sort(), ["keeperLane", "kickerLane", "result", "round", "statusMessage"]);
});

test("coordinator: second state update gets the next sequence", () => {
  const c = new UnityPresentationShadowCoordinator();
  assert.equal(c.acceptMatchUpdate("ABCD12", freshUpdate())?.envelope.sequence, 1);
  assert.equal(c.acceptMatchUpdate("ABCD12", freshUpdate({ round: 3 }))?.envelope.sequence, 2);
});

test("coordinator: state-then-result preserves actual dispatch order", () => {
  const c = new UnityPresentationShadowCoordinator();
  const s = c.acceptMatchUpdate("ABCD12", freshUpdate());
  const r = c.acceptRoundResult(RESULT_RAW);
  assert.equal(s?.envelope.sequence, 1);
  assert.equal(r?.envelope.sequence, 2);
  assert.ok((s?.envelope.sequence ?? 0) < (r?.envelope.sequence ?? 0));
});

test("coordinator: result-then-later-state preserves actual dispatch order", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 0, p2: 0 }, round: 1 })); // seq 1
  const r = c.acceptRoundResult(RESULT_RAW); // seq 2
  const s = c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 1, p2: 0 }, round: 2 })); // seq 3
  assert.equal(r?.envelope.sequence, 2);
  assert.equal(s?.envelope.sequence, 3);
});

test("coordinator: stale pre-result scores are not relabeled/incremented", () => {
  const c = new UnityPresentationShadowCoordinator();
  const pre = c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 0, p2: 0 }, round: 1 }));
  assert.deepStrictEqual(pre?.envelope.event === "match_state_sync" ? pre.envelope.payload.scores : null, { p1: 0, p2: 0 });
  const r = c.acceptRoundResult(RESULT_RAW);
  assert.equal("scores" in (r?.envelope.payload ?? {}), false); // result never carries a score
});

test("coordinator: later authoritative updated scores are copied exactly", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 0, p2: 0 }, round: 1 }));
  const post = c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 1, p2: 0 }, round: 2 }));
  assert.deepStrictEqual(post?.envelope.event === "match_state_sync" ? post.envelope.payload.scores : null, { p1: 1, p2: 0 });
});

test("coordinator: no local score calculation (scores copied verbatim)", () => {
  const c = new UnityPresentationShadowCoordinator();
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 2, p2: 2 } }));
  assert.deepStrictEqual(d?.envelope.event === "match_state_sync" ? d.envelope.payload.scores : null, { p1: 2, p2: 2 });
});

test("coordinator: new authoritative matchInstance resets sequence to 1", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate({ matchInstance: 1 })); // seq 1
  c.acceptRoundResult(RESULT_RAW); // seq 2
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate({ matchInstance: 2 })); // new instance → seq 1
  assert.equal(d?.envelope.matchInstanceId, "ABCD12:2");
  assert.equal(d?.envelope.sequence, 1);
});

test("coordinator: a new instance clears the prior terminal snapshot", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate({ matchInstance: 1, scores: { p1: 2, p2: 1 }, round: 3, maxRounds: 3 }));
  c.acceptMatchUpdate("ABCD12", freshUpdate({ matchInstance: 2, scores: { p1: 0, p2: 0 }, round: 1, maxRounds: 3 }));
  const term = c.acceptMatchEnd({ scores: { p1: 1, p2: 0 } });
  assert.ok(term && term.envelope.event === "match_state_sync");
  assert.equal(term.envelope.matchInstanceId, "ABCD12:2"); // NOT ABCD12:1
  assert.equal(term.envelope.payload.round, 1); // from the inst-2 snapshot, not inst-1's round 3
});

test("coordinator: an old-instance prior cannot be reused for terminal sync", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate({ matchInstance: 1 })); // prior inst-1 stored
  // A new-instance update whose body is malformed clears the prior and switches
  // the active instance to 2, leaving no inst-2 prior.
  assert.equal(c.acceptMatchUpdate("ABCD12", freshUpdate({ matchInstance: 2, scores: { p1: -1 } })), null);
  assert.equal(c.getActiveInstanceId(), "ABCD12:2");
  assert.equal(c.hasPriorSnapshot(), false);
  // match:end now finds no valid same-instance prior → null (inst-1 prior not reused).
  assert.equal(c.acceptMatchEnd({ scores: { p1: 3, p2: 1 } }), null);
});

test("coordinator: terminal match:end with a valid same-instance prior works", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 2, p2: 1 }, round: 3, maxRounds: 3, phase: "NORMAL" }));
  const term = c.acceptMatchEnd({ scores: { p1: 3, p2: 1 } });
  assert.ok(term && term.envelope.event === "match_state_sync");
  assert.deepStrictEqual(term.envelope.payload, { scores: { p1: 3, p2: 1 }, round: 3, maxRounds: 3, phase: "NORMAL", suddenDeathRound: 0 });
});

test("coordinator: terminal match:end without a prior returns null", () => {
  const c = new UnityPresentationShadowCoordinator();
  assert.equal(c.acceptMatchEnd({ scores: { p1: 3, p2: 1 } }), null);
});

test("coordinator: ready resync uses the last complete sanitized state", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 1, p2: 0 }, round: 2, maxRounds: 3 })); // seq 1
  const resync = c.buildReadyResync(); // seq 2
  assert.ok(resync && resync.envelope.event === "match_state_sync");
  assert.equal(resync.envelope.sequence, 2);
  assert.deepStrictEqual(resync.envelope.payload.scores, { p1: 1, p2: 0 });
  assert.equal(resync.audit.source, "ready_resync");
});

test("coordinator: ready resync does not replay round_result", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate());
  c.acceptRoundResult(RESULT_RAW);
  const resync = c.buildReadyResync();
  assert.equal(resync?.envelope.event, "match_state_sync"); // never round_result
});

test("coordinator: ready resync with no snapshot returns null", () => {
  const c = new UnityPresentationShadowCoordinator();
  assert.equal(c.buildReadyResync(), null);
});

test("coordinator: raw match:rejoinState produces no direct state sync", () => {
  const c = new UnityPresentationShadowCoordinator();
  // Exact current rejoinState shape (no scores, no maxRounds).
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
  assert.equal(c.acceptMatchUpdate("ABCD12", rejoin), null);
});

test("coordinator: source extra fields are stripped from the envelope", () => {
  const c = new UnityPresentationShadowCoordinator();
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate());
  assert.ok(d && d.envelope.event === "match_state_sync");
  assert.deepStrictEqual(Object.keys(d.envelope.payload).sort(), ["maxRounds", "phase", "round", "scores", "suddenDeathRound"]);
});

test("coordinator: sensitive fields never reach the envelope", () => {
  const c = new UnityPresentationShadowCoordinator();
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate());
  const r = c.acceptRoundResult(RESULT_RAW);
  for (const dispatch of [d, r]) {
    const json = JSON.stringify(dispatch?.envelope.payload);
    for (const bad of ["authToken", "wallet", "isResolving", "roomCode", "SECRET"]) {
      assert.equal(json.includes(bad), false, `leaked ${bad}`);
    }
  }
});

test("audit: summary carries no player ids and no sensitive fields", () => {
  const c = new UnityPresentationShadowCoordinator();
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate({ scores: { p1: 2, p2: 5 } }));
  assert.ok(d);
  assert.deepStrictEqual(d.audit.scoreValues, [2, 5]); // sorted VALUES only
  assert.equal(d.audit.playerCount, 2);
  const json = JSON.stringify(d.audit);
  for (const bad of ["p1", "p2", "authToken", "wallet", "SECRET", "roomCode"]) {
    assert.equal(json.includes(bad), false, `audit leaked ${bad}`);
  }
});

test("id: stable message id format <matchInstanceId>:<sequence>:<event>", () => {
  const c = new UnityPresentationShadowCoordinator();
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate());
  assert.ok(d);
  assert.equal(d.id, "ABCD12:1:1:match_state_sync");
  assert.equal(makeShadowMessageId(d.envelope), d.id);
});

test("coordinator: hostile getters/proxies never throw (controlled null)", () => {
  const c = new UnityPresentationShadowCoordinator();
  const hostile: Record<string, unknown> = { matchInstance: 1, round: 2, maxRounds: 3, phase: "NORMAL" };
  Object.defineProperty(hostile, "scores", { enumerable: true, get() { throw new Error("boom"); } });
  assert.doesNotThrow(() => c.acceptMatchUpdate("ABCD12", hostile));
  assert.equal(c.acceptMatchUpdate("ABCD12", hostile), null);
  const badProxy = new Proxy({}, { ownKeys() { throw new Error("x"); } });
  assert.doesNotThrow(() => c.acceptMatchUpdate("ABCD12", { matchInstance: 1, scores: badProxy, round: 1, maxRounds: 3, phase: "NORMAL" }));
  assert.doesNotThrow(() => c.acceptRoundResult(null));
  assert.doesNotThrow(() => c.acceptMatchEnd(undefined));
  assert.doesNotThrow(() => c.buildReadyResync());
});

test("compare: envelope-vs-source PASS/FAIL/PENDING", () => {
  const c = new UnityPresentationShadowCoordinator();
  const raw = freshUpdate({ scores: { p1: 1, p2: 0 }, round: 2, maxRounds: 3, phase: "NORMAL" });
  const d = c.acceptMatchUpdate("ABCD12", raw);
  assert.ok(d);
  assert.equal(compareEnvelopeToSource(d.envelope, raw), "PASS");
  assert.equal(compareEnvelopeToSource(d.envelope, { ...raw, round: 9 }), "FAIL");
  assert.equal(compareEnvelopeToSource(d.envelope, null), "PENDING"); // terminal/resync have no raw source
  const rr = c.acceptRoundResult(RESULT_RAW);
  assert.ok(rr);
  assert.equal(compareEnvelopeToSource(rr.envelope, RESULT_RAW), "PASS");
});

test("audit: buildAuditSummary shape for round_result", () => {
  const c = new UnityPresentationShadowCoordinator();
  c.acceptMatchUpdate("ABCD12", freshUpdate());
  const r = c.acceptRoundResult(RESULT_RAW);
  assert.ok(r);
  const a = buildAuditSummary(r.envelope, "match:result");
  assert.equal(a.event, "round_result");
  assert.equal(a.result, "GOAL");
  assert.equal(a.round, 1);
  assert.equal("scoreValues" in a, false);
});

// ════════════════════════════════ DISPATCH QUEUE ═════════════════════════════

test("queue: fifo mode preserves order", () => {
  const q = new ShadowDispatchQueue();
  assert.deepStrictEqual(q.enqueue("a", { event: "x" }), { ok: true });
  assert.deepStrictEqual(q.enqueue("b", { event: "y" }), { ok: true });
  assert.deepStrictEqual(q.enqueue("c", { event: "z" }), { ok: true });
  assert.deepStrictEqual(q.drain().map((m) => m.id), ["a", "b", "c"]);
});

test("queue: duplicate queued id rejected", () => {
  const q = new ShadowDispatchQueue();
  assert.deepStrictEqual(q.enqueue("a", {}), { ok: true });
  assert.deepStrictEqual(q.enqueue("a", {}), { ok: false, reason: "duplicate" });
  assert.equal(q.size(), 1);
});

test("queue: duplicate sent id rejected after drain", () => {
  const q = new ShadowDispatchQueue();
  q.enqueue("a", {});
  q.drain();
  assert.equal(q.hasSent("a"), true);
  assert.deepStrictEqual(q.enqueue("a", {}), { ok: false, reason: "duplicate" });
});

test("queue: overflow returns a controlled failure (cap 32)", () => {
  const q = new ShadowDispatchQueue(3);
  assert.deepStrictEqual(q.enqueue("1", {}), { ok: true });
  assert.deepStrictEqual(q.enqueue("2", {}), { ok: true });
  assert.deepStrictEqual(q.enqueue("3", {}), { ok: true });
  assert.deepStrictEqual(q.enqueue("4", {}), { ok: false, reason: "overflow" });
});

test("queue: reset clears queued + sent (instance change / iframe reload policy)", () => {
  const q = new ShadowDispatchQueue();
  q.enqueue("a", {});
  q.drain();
  q.enqueue("b", {});
  q.reset();
  assert.equal(q.size(), 0);
  assert.equal(q.hasSent("a"), false);
  // After reset, previously-sent ids can be enqueued again for the new lifecycle.
  assert.deepStrictEqual(q.enqueue("a", {}), { ok: true });
});

test("queue: latest-vs-fifo — draining twice does not resend already-sent items", () => {
  const q = new ShadowDispatchQueue();
  q.enqueue("a", {});
  assert.deepStrictEqual(q.drain().map((m) => m.id), ["a"]);
  assert.deepStrictEqual(q.drain(), []); // nothing left; no resend
});

// ── sanitized sent-summary (renderer onMessageSent) ───────────────────────────

test("sent summary: versioned envelope carries validated instance/sequence", () => {
  const c = new UnityPresentationShadowCoordinator();
  const d = c.acceptMatchUpdate("ABCD12", freshUpdate());
  assert.ok(d);
  const s = summarizeSentMessage(d.envelope, d.id);
  assert.deepStrictEqual(s, {
    messageId: "ABCD12:1:1:match_state_sync",
    event: "match_state_sync",
    matchInstanceId: "ABCD12:1",
    sequence: 1,
  });
});

test("sent summary: legacy message has no invented instance/sequence", () => {
  const legacy = { type: "PENALTY444_MATCH_EVENT", event: "staging_begin", payload: { startsAt: 1 } };
  const s = summarizeSentMessage(legacy, "legacy-id-1");
  assert.deepStrictEqual(s, { messageId: "legacy-id-1", event: "staging_begin" });
  assert.equal("matchInstanceId" in s, false);
  assert.equal("sequence" in s, false);
});

test("sent summary: never throws on junk", () => {
  for (const j of [null, undefined, 5, "x", [], () => {}]) {
    assert.doesNotThrow(() => summarizeSentMessage(j, "id"));
  }
});
