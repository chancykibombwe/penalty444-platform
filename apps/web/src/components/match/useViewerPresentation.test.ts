/**
 * B6D3B PR-2 — viewer presentation adapter tests.
 * Node `node:test` via `tsx`. Pure; no React, no network, no Unity.
 *
 * The decisive assertions are the privacy ones: neither participant's RAW player
 * id may appear anywhere in the identity output or in the projected message JSON.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildViewerPresentation,
  projectStateSyncForViewer,
  VIEWER_SCORE_KEY_OPPONENT,
  VIEWER_SCORE_KEY_SELF,
} from "./useViewerPresentation";
import {
  PRESENTATION_PROTOCOL_VERSION,
  PRESENTATION_TYPE,
  type MatchStateSyncEnvelope,
} from "./unityPresentationProtocol";
import { buildViewerIdentityContext } from "./unityPresentationIdentity";

const INSTANCE = "ABCD12:1";
const SELF_ID = "self-11111111-2222-3333-4444-555555555555";
const OPP_ID = "opp-99999999-8888-7777-6666-555555555555";

function stateSync(over: {
  sequence: number;
  round?: number;
  maxRounds?: number;
  phase?: "NORMAL" | "SUDDEN_DEATH";
  suddenDeathRound?: number;
  scores?: Record<string, number>;
  matchInstanceId?: string;
  emittedAt?: number;
}) {
  const payload: Record<string, unknown> = {
    scores: over.scores ?? { [SELF_ID]: 2, [OPP_ID]: 1 },
    round: over.round ?? 3,
    maxRounds: over.maxRounds ?? 5,
    phase: over.phase ?? "NORMAL",
  };
  if (over.suddenDeathRound !== undefined) payload.suddenDeathRound = over.suddenDeathRound;
  const env: Record<string, unknown> = {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId: over.matchInstanceId ?? INSTANCE,
    sequence: over.sequence,
    event: "match_state_sync",
    payload,
  };
  if (over.emittedAt !== undefined) env.emittedAt = over.emittedAt;
  return env;
}

function roundResult(over: { sequence: number; round?: number; matchInstanceId?: string }) {
  return {
    type: PRESENTATION_TYPE,
    protocolVersion: PRESENTATION_PROTOCOL_VERSION,
    matchInstanceId: over.matchInstanceId ?? INSTANCE,
    sequence: over.sequence,
    event: "round_result",
    payload: {
      round: over.round ?? 2,
      kickerLane: "LEFT",
      keeperLane: "RIGHT",
      result: "GOAL",
    },
  };
}

function baseInput(over: Partial<Parameters<typeof buildViewerPresentation>[0]> = {}) {
  return {
    matchInstanceId: INSTANCE,
    viewerPlayerId: SELF_ID,
    scores: { [SELF_ID]: 2, [OPP_ID]: 1 },
    pending: [] as ReadonlyArray<{ id: string; message: unknown }>,
    ...over,
  };
}

// ── identity ──────────────────────────────────────────────────────────────────

test("SELF maps to LEFT and OPPONENT to RIGHT with authoritative scores", () => {
  const out = buildViewerPresentation(baseInput());
  assert.ok(out.identity);
  assert.equal(out.identity.self.participant, "SELF");
  assert.equal(out.identity.self.side, "LEFT");
  assert.equal(out.identity.self.score, 2);
  assert.equal(out.identity.opponent.participant, "OPPONENT");
  assert.equal(out.identity.opponent.side, "RIGHT");
  assert.equal(out.identity.opponent.score, 1);
});

test("raw ids are absent from the identity output", () => {
  const out = buildViewerPresentation(
    baseInput({
      kickerPlayerId: SELF_ID,
      keeperPlayerId: OPP_ID,
      displayNames: { [SELF_ID]: "Ada", [OPP_ID]: "Blake" },
    }),
  );
  const json = JSON.stringify(out.identity);
  assert.equal(json.includes(SELF_ID), false);
  assert.equal(json.includes(OPP_ID), false);
});

test("no legacy winnerId is ever emitted", () => {
  const out = buildViewerPresentation(baseInput());
  assert.equal(JSON.stringify(out).includes("winnerId"), false);
});

test("missing/unknown viewer yields the empty presentation", () => {
  assert.equal(buildViewerPresentation(baseInput({ viewerPlayerId: null })).identity, null);
  assert.equal(buildViewerPresentation(baseInput({ viewerPlayerId: "stranger" })).identity, null);
  assert.equal(buildViewerPresentation(baseInput({ matchInstanceId: null })).identity, null);
  assert.deepStrictEqual(buildViewerPresentation(baseInput({ matchInstanceId: null })).messages, []);
});

// ── projection ────────────────────────────────────────────────────────────────

test("match_state_sync score keys become exactly LEFT and RIGHT", () => {
  const out = buildViewerPresentation(
    baseInput({ pending: [{ id: `${INSTANCE}:4:match_state_sync`, message: stateSync({ sequence: 4 }) }] }),
  );
  assert.equal(out.messages.length, 1);
  const msg = out.messages[0].message as MatchStateSyncEnvelope;
  assert.deepStrictEqual(Object.keys(msg.payload.scores).sort(), ["LEFT", "RIGHT"]);
  assert.equal(msg.payload.scores[VIEWER_SCORE_KEY_SELF], 2);
  assert.equal(msg.payload.scores[VIEWER_SCORE_KEY_OPPONENT], 1);
});

test("raw ids are absent from the projected message JSON", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: `${INSTANCE}:4:match_state_sync`, message: stateSync({ sequence: 4 }) },
        { id: `${INSTANCE}:5:round_result`, message: roundResult({ sequence: 5 }) },
      ],
    }),
  );
  const json = JSON.stringify(out);
  assert.equal(json.includes(SELF_ID), false);
  assert.equal(json.includes(OPP_ID), false);
});

test("authoritative values are preserved verbatim (nothing derived)", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        {
          id: "x",
          message: stateSync({
            sequence: 9,
            round: 7,
            maxRounds: 5,
            phase: "SUDDEN_DEATH",
            suddenDeathRound: 2,
            emittedAt: 1730000000000,
          }),
        },
      ],
    }),
  );
  const msg = out.messages[0].message as MatchStateSyncEnvelope;
  assert.equal(msg.type, PRESENTATION_TYPE);
  assert.equal(msg.protocolVersion, PRESENTATION_PROTOCOL_VERSION);
  assert.equal(msg.matchInstanceId, INSTANCE);
  assert.equal(msg.sequence, 9);
  assert.equal(msg.event, "match_state_sync");
  assert.equal(msg.emittedAt, 1730000000000);
  assert.equal(msg.payload.round, 7);
  assert.equal(msg.payload.maxRounds, 5);
  assert.equal(msg.payload.phase, "SUDDEN_DEATH");
  assert.equal(msg.payload.suddenDeathRound, 2);
});

test("round_result is copied through without derivation", () => {
  const out = buildViewerPresentation(
    baseInput({ pending: [{ id: "r", message: roundResult({ sequence: 6, round: 4 }) }] }),
  );
  assert.equal(out.messages.length, 1);
  const msg = out.messages[0].message;
  assert.equal(msg.event, "round_result");
  if (msg.event === "round_result") {
    assert.equal(msg.payload.round, 4);
    assert.equal(msg.payload.result, "GOAL");
    assert.equal(msg.payload.kickerLane, "LEFT");
    assert.equal(msg.payload.keeperLane, "RIGHT");
  }
  assert.equal(JSON.stringify(msg).includes("scores"), false);
});

test("malformed envelopes are rejected", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "a", message: { nope: true } },
        { id: "b", message: null },
        { id: "c", message: { ...stateSync({ sequence: 2 }), protocolVersion: 2 } },
        { id: "d", message: 42 },
      ],
    }),
  );
  assert.deepStrictEqual(out.messages, []);
});

test("foreign-instance messages are rejected", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "a", message: stateSync({ sequence: 2, matchInstanceId: "ABCD12:2" }) },
        { id: "b", message: roundResult({ sequence: 3, matchInstanceId: "WXYZ99:1" }) },
      ],
    }),
  );
  assert.deepStrictEqual(out.messages, []);
});

test("inputs are never mutated", () => {
  const original = stateSync({ sequence: 4 });
  const snapshot = JSON.parse(JSON.stringify(original));
  const scores = { [SELF_ID]: 2, [OPP_ID]: 1 };
  const scoresSnapshot = { ...scores };
  const pending = [{ id: "keep", message: original }];
  buildViewerPresentation(baseInput({ scores, pending }));
  assert.deepStrictEqual(original, snapshot, "source envelope must not be mutated");
  assert.deepStrictEqual(scores, scoresSnapshot, "source score map must not be mutated");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].message, original, "pending queue must not be replaced");
});

test("projectStateSyncForViewer rejects a foreign instance", () => {
  const identity = buildViewerIdentityContext({
    matchInstanceId: INSTANCE,
    viewerPlayerId: SELF_ID,
    scores: { [SELF_ID]: 1, [OPP_ID]: 0 },
  });
  assert.ok(identity);
  const foreign = stateSync({ sequence: 2, matchInstanceId: "ABCD12:2" });
  // Build a validated envelope for the foreign instance, then project it.
  const out = buildViewerPresentation(
    baseInput({ pending: [{ id: "f", message: foreign }] }),
  );
  assert.deepStrictEqual(out.messages, []);
  assert.equal(
    projectStateSyncForViewer(
      { ...(foreign as unknown as MatchStateSyncEnvelope) },
      identity,
    ),
    null,
  );
});

// ── correlation ───────────────────────────────────────────────────────────────

test("terminal correlation (same round) is accepted", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "r", message: roundResult({ sequence: 4, round: 3 }) },
        { id: "s", message: stateSync({ sequence: 5, round: 3 }) },
      ],
    }),
  );
  assert.ok(out.correlation);
  assert.equal(out.correlation.resultRound, 3);
  assert.equal(out.correlation.stateSyncRound, 3);
});

test("continuation correlation (next round) is accepted", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "r", message: roundResult({ sequence: 4, round: 3 }) },
        { id: "s", message: stateSync({ sequence: 5, round: 4 }) },
      ],
    }),
  );
  assert.ok(out.correlation);
  assert.equal(out.correlation.stateSyncRound, 4);
});

test("stale/duplicate sequence is not correlated", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "r", message: roundResult({ sequence: 5, round: 3 }) },
        { id: "s", message: stateSync({ sequence: 5, round: 3 }) },
      ],
    }),
  );
  assert.equal(out.correlation, null);
});

test("invalid round order is not correlated", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "r", message: roundResult({ sequence: 4, round: 3 }) },
        { id: "s", message: stateSync({ sequence: 5, round: 9 }) },
      ],
    }),
  );
  assert.equal(out.correlation, null);
});

test("a foreign-instance pair never correlates (both dropped first)", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "r", message: roundResult({ sequence: 4, round: 3, matchInstanceId: "ABCD12:2" }) },
        { id: "s", message: stateSync({ sequence: 5, round: 4, matchInstanceId: "ABCD12:2" }) },
      ],
    }),
  );
  assert.deepStrictEqual(out.messages, []);
  assert.equal(out.correlation, null);
});

test("correlation is null when no result/state-sync pair is present", () => {
  const out = buildViewerPresentation(
    baseInput({ pending: [{ id: "s", message: stateSync({ sequence: 5 }) }] }),
  );
  assert.equal(out.correlation, null);
});

test("correlation summary leaks no raw ids", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [
        { id: "r", message: roundResult({ sequence: 4, round: 3 }) },
        { id: "s", message: stateSync({ sequence: 5, round: 4 }) },
      ],
    }),
  );
  const json = JSON.stringify(out.correlation);
  assert.equal(json.includes(SELF_ID), false);
  assert.equal(json.includes(OPP_ID), false);
});

// ── message ids ───────────────────────────────────────────────────────────────

test("an id containing a raw player id is replaced with a safe derived id", () => {
  const out = buildViewerPresentation(
    baseInput({
      pending: [{ id: `${SELF_ID}:4:match_state_sync`, message: stateSync({ sequence: 4 }) }],
    }),
  );
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].id.includes(SELF_ID), false);
  assert.equal(out.messages[0].id, `${INSTANCE}:4:match_state_sync`);
});

test("a safe id is preserved unchanged", () => {
  const id = `${INSTANCE}:4:match_state_sync`;
  const out = buildViewerPresentation(
    baseInput({ pending: [{ id, message: stateSync({ sequence: 4 }) }] }),
  );
  assert.equal(out.messages[0].id, id);
});
