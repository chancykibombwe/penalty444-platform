/**
 * B6D3C — protected-preview MOCK proof harness tests.
 *
 * Node `node:test` via `tsx`, plus source inspection of the route and client.
 * No React Testing Library, no jsdom, no new dependency.
 *
 * Four concerns are covered:
 *   1. the SERVER route contract (production denied first, explicit opt-in, no
 *      query-string configuration, no NEXT_PUBLIC gate, no MatchRoomPanel),
 *   2. the PURE proof plan (determinism, ordering, gate coverage, expectations
 *      that match the merged Unity Protocol v1 gate),
 *   3. SANITIZATION (no synthetic raw identifier survives projection, evidence or
 *      report; the report refuses to be built otherwise),
 *   4. the CLIENT integration source guards (reuse of the merged host and gate,
 *      strict listener, explicit target origin, one-iframe invariant, no socket,
 *      no gameplay control).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MOCK_OPPONENT_ID,
  MOCK_VIEWER_ID,
  PROHIBITED_EVIDENCE_KEYS,
  PROHIBITED_VALUES,
  PROOF_BASELINE_SHA,
  PROOF_FOREIGN_INSTANCE,
  PROOF_GATE_IDS,
  PROOF_INSTANCE_A,
  PROOF_INSTANCE_B,
  PROOF_ROUTE,
  PROOF_STEPS,
  REQUIRED_BUILD_URL,
  SAFE_REJECT_REASONS,
  acknowledgementMatches,
  assertNoProhibitedValues,
  buildEvidenceRowFromAck,
  buildHarnessEvidenceRow,
  buildOutboundEvidenceRow,
  buildProofReport,
  buildRawHostInputs,
  buildRawRoundResult,
  buildRawStateSync,
  buildSanitizedNegativeEnvelope,
  classifyGate,
  classifyNetworkPath,
  classifyNetworkUrl,
  containsProhibitedKey,
  containsProhibitedValue,
  isSafeRejectReason,
  normalizeAcknowledgement,
  projectProofFeed,
  projectedFeedIsSanitized,
  proofStepOrderIsValid,
  type ProofEvidenceRow,
  type ProofStep,
} from "./unityB6D3CProof";
import { validateEnvelope } from "../../../components/match/unityPresentationProtocol";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const pageSource = readFileSync(`${HERE}page.tsx`, "utf8");
const clientSource = readFileSync(`${HERE}UnityB6D3CProofClient.tsx`, "utf8");
const proofSource = readFileSync(`${HERE}unityB6D3CProof.ts`, "utf8");

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const stepOf = (n: number): ProofStep => PROOF_STEPS[n - 1];

/**
 * Strip comments so a negative source assertion tests CODE, not prose. A comment
 * that merely names a forbidden thing ("never a NEXT_PUBLIC_* gate") must not
 * masquerade as a violation, and must not let a real one hide either.
 * The `[^:"'\`]` guard keeps `https://` inside a string literal intact.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const pageCode = stripComments(pageSource);
const clientCode = stripComments(clientSource);
const proofCode = stripComments(proofSource);

// ── 1. Server route contract ──────────────────────────────────────────────────

test("production is denied FIRST, before the enable flag is even read", () => {
  const prodIndex = pageCode.indexOf('process.env.VERCEL_ENV === "production"');
  const flagIndex = pageCode.indexOf("B6D3C_PROOF_ROUTE_ENABLED");
  assert.ok(prodIndex > 0, "the production check must exist");
  assert.ok(flagIndex > 0, "the enable flag must exist");
  assert.ok(prodIndex < flagIndex, "production must be checked before the enable flag");
});

test("the route requires an explicit server-side opt-in and 404s otherwise", () => {
  assert.ok(/process\.env\.B6D3C_PROOF_ROUTE_ENABLED !== "true"/.test(pageCode));
  assert.equal(count(pageCode, "notFound()"), 2, "both gates must call notFound()");
  assert.ok(pageCode.includes('import { notFound } from "next/navigation"'));
});

test("the gate is never NODE_ENV and never a NEXT_PUBLIC flag", () => {
  assert.equal(
    /process\.env\.NODE_ENV/.test(pageCode),
    false,
    "NODE_ENV must not gate the route",
  );
  assert.equal(
    /process\.env\.NEXT_PUBLIC/.test(pageCode),
    false,
    "a public flag can never be the server gate",
  );
});

test("the route accepts no query string and derives nothing from the request", () => {
  for (const forbidden of ["searchParams", "params", "headers()", "cookies()", "Request"]) {
    assert.equal(pageCode.includes(forbidden), false, `route must not use ${forbidden}`);
  }
  // The page component takes no arguments at all.
  assert.ok(/export default async function UnityB6D3CProofPage\(\)/.test(pageCode));
});

test("no proof file imports a match, socket or gameplay surface", () => {
  for (const [name, code] of Object.entries({
    page: pageCode,
    client: clientCode,
    pure: proofCode,
  })) {
    assert.equal(/MatchRoomPanel/.test(code), false, `${name} must not touch MatchRoomPanel`);
    assert.equal(
      /from ["'][^"']*socket/.test(code),
      false,
      `${name} must not import a socket client`,
    );
    assert.equal(/\bio\s*\(/.test(code), false, `${name} must not open a socket`);
    assert.equal(/\.emit\s*\(/.test(code), false, `${name} must not emit a socket event`);
    assert.equal(
      /match:(pick|result|update)/.test(code),
      false,
      `${name} must not use match events`,
    );
    assert.equal(
      /from ["'][^"']*supabase/.test(code),
      false,
      `${name} must not read Supabase directly`,
    );
  }
});

test("the harness issues no request of its own — the merged gate owns them all", () => {
  assert.equal(/\bfetch\s*\(/.test(clientCode), false, "the client must not call fetch");
  assert.equal(/XMLHttpRequest/.test(clientCode), false);
  assert.equal(/new WebSocket/.test(clientCode), false);
  assert.equal(/EventSource/.test(clientCode), false);
});

test("the proof surface is never cached or prerendered", () => {
  assert.ok(/export const dynamic = "force-dynamic"/.test(pageSource));
  assert.ok(/export const revalidate = 0/.test(pageSource));
});

// ── 2. The pure proof plan ────────────────────────────────────────────────────

test("steps are contiguous, ordered and immutable", () => {
  assert.equal(proofStepOrderIsValid(), true);
  assert.equal(PROOF_STEPS.length, 16);
  assert.equal(Object.isFrozen(PROOF_STEPS), true);
  const labels = new Set(PROOF_STEPS.map((s) => s.label));
  assert.equal(labels.size, PROOF_STEPS.length, "labels must be distinct");
});

test("every gate is exercised by at least one step", () => {
  for (const gate of PROOF_GATE_IDS) {
    assert.ok(
      PROOF_STEPS.some((s) => s.gate === gate),
      `gate ${gate} has no step`,
    );
  }
});

test("all POSITIVE lifecycle evidence flows through the merged host", () => {
  for (const step of PROOF_STEPS) {
    if (step.expect.kind !== "applied") continue;
    assert.equal(
      step.channel,
      "host",
      `step ${step.step} applies state and must use the host path`,
    );
  }
});

test("direct injection is used ONLY for host-filtered negatives", () => {
  const direct = PROOF_STEPS.filter((s) => s.channel === "direct-negative");
  assert.ok(direct.length > 0);
  for (const step of direct) {
    assert.equal(step.expect.kind, "rejected", `step ${step.step} must expect a rejection`);
    if (step.expect.kind === "rejected") {
      assert.ok(
        ["stale_or_duplicate", "foreign_instance"].includes(step.expect.reason),
        `step ${step.step} may only prove duplicate/stale/foreign`,
      );
    }
  }
});

test("every expected rejection reason is in the merged allowlist", () => {
  for (const step of PROOF_STEPS) {
    if (step.expect.kind !== "rejected") continue;
    assert.equal(isSafeRejectReason(step.expect.reason), true);
    assert.ok(SAFE_REJECT_REASONS.includes(step.expect.reason));
  }
});

test("the plan proves result/state separation with the exact sequences", () => {
  const result = stepOf(3);
  const sync = stepOf(4);
  assert.equal(result.expect.kind, "applied");
  if (result.expect.kind === "applied") {
    assert.equal(result.expect.event, "round_result");
    assert.equal(result.expect.result, "GOAL");
    assert.equal(result.expect.scoreValues, undefined, "a result ack carries no score");
  }
  if (sync.expect.kind === "applied") {
    assert.equal(sync.expect.event, "match_state_sync");
    assert.equal(sync.expect.sequence, 3);
    assert.deepEqual([...(sync.expect.scoreValues ?? [])], [0, 1]);
  }
});

test("the instance transition matches the compiled gate: same room, higher instance, sequence 1", () => {
  const [roomA, numberA] = PROOF_INSTANCE_A.split(":");
  const [roomB, numberB] = PROOF_INSTANCE_B.split(":");
  assert.equal(roomA, roomB, "a transition must stay inside the same room");
  assert.ok(Number(numberB) > Number(numberA), "the instance number must increase");
  const transition = stepOf(11);
  assert.equal(transition.expect.kind, "applied");
  if (transition.expect.kind === "applied") {
    assert.equal(transition.expect.sequence, 1, "the compiled gate requires exactly 1");
    assert.equal(transition.expect.matchInstanceId, PROOF_INSTANCE_B);
  }
  // The foreign case must be a DIFFERENT room, or the gate would report a
  // transition failure instead of a foreign instance.
  assert.notEqual(PROOF_FOREIGN_INSTANCE.split(":")[0], roomA);
});

test("the post-reload bootstrap deliberately uses a sequence greater than 1", () => {
  const step = stepOf(14);
  assert.equal(step.expect.kind, "applied");
  if (step.expect.kind === "applied") {
    assert.ok(step.expect.sequence > 1, "a fresh receiver must accept any positive sequence");
    assert.equal(step.expect.event, "match_state_sync", "a bootstrap must be a complete sync");
  }
});

test("the fail-open step requires a terminal state with zero Unity iframes", () => {
  const step = stepOf(15);
  assert.equal(step.expect.kind, "host-state");
  if (step.expect.kind === "host-state") {
    assert.equal(step.expect.hostState, "UNITY_FAILED_REACT_FALLBACK");
    assert.equal(step.expect.iframeCount, 0);
  }
});

test("raw mock inputs are well-formed Protocol v1 and id-keyed", () => {
  for (const instance of [PROOF_INSTANCE_A, PROOF_INSTANCE_B]) {
    const inputs = buildRawHostInputs(instance);
    assert.ok(inputs.length > 0);
    for (const item of inputs) {
      const validated = validateEnvelope(item.message);
      assert.notEqual(validated, null, `raw input ${item.id} must validate`);
      assert.equal(validated?.matchInstanceId, instance);
      assert.equal(item.id.includes(MOCK_VIEWER_ID), false, "ids never contain a player id");
    }
    // The raw side (and only the raw side) is keyed by synthetic player ids.
    const first = inputs[0].message as { payload: { scores: Record<string, number> } };
    assert.deepEqual(Object.keys(first.payload.scores).sort(), [MOCK_OPPONENT_ID, MOCK_VIEWER_ID].sort());
  }
});

test("the mock feed is deterministic across calls", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(buildRawHostInputs(PROOF_INSTANCE_A))),
    JSON.parse(JSON.stringify(buildRawHostInputs(PROOF_INSTANCE_A))),
  );
  assert.deepEqual(
    JSON.stringify(projectProofFeed(PROOF_INSTANCE_A, buildRawHostInputs(PROOF_INSTANCE_A)).messages),
    JSON.stringify(projectProofFeed(PROOF_INSTANCE_A, buildRawHostInputs(PROOF_INSTANCE_A)).messages),
  );
});

test("each projected snapshot keeps its OWN scores, not the live ones", () => {
  // Live outer scores are deliberately far ahead of every queued envelope.
  const feed = projectProofFeed(PROOF_INSTANCE_A, buildRawHostInputs(PROOF_INSTANCE_A), 9, 9);
  assert.equal(feed.identityPresent, true);
  const syncs = feed.messages
    .map((m) => m.message)
    .filter((m) => m.event === "match_state_sync");
  const observed = syncs.map((m) =>
    m.event === "match_state_sync" ? [m.payload.scores.LEFT, m.payload.scores.RIGHT] : null,
  );
  assert.deepEqual(observed, [
    [0, 0],
    [1, 0],
    [3, 3],
  ]);
});

test("a foreign-instance envelope never survives the merged adapter", () => {
  const feed = projectProofFeed(PROOF_INSTANCE_A, [
    {
      id: `${PROOF_FOREIGN_INSTANCE}:5:match_state_sync`,
      message: buildRawStateSync({
        matchInstanceId: PROOF_FOREIGN_INSTANCE,
        sequence: 5,
        selfScore: 9,
        opponentScore: 9,
        round: 4,
        maxRounds: 5,
        phase: "NORMAL",
      }),
    },
  ]);
  assert.equal(feed.messages.length, 0);
});

test("a round_result is projected without any score map", () => {
  const feed = projectProofFeed(PROOF_INSTANCE_A, [
    {
      id: `${PROOF_INSTANCE_A}:2:round_result`,
      message: buildRawRoundResult({
        matchInstanceId: PROOF_INSTANCE_A,
        sequence: 2,
        round: 1,
        kickerLane: "LEFT",
        keeperLane: "RIGHT",
        result: "GOAL",
      }),
    },
  ]);
  // Identity needs a score map, which a lone round_result feed cannot supply, so
  // the projection is driven by the live outer scores instead.
  assert.equal(feed.messages.length, 1);
  const message = feed.messages[0].message;
  assert.equal(message.event, "round_result");
  assert.equal(JSON.stringify(message).includes("scores"), false);
});

test("direct-negative envelopes are LEFT/RIGHT keyed and valid", () => {
  const envelope = buildSanitizedNegativeEnvelope({
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 3,
    leftScore: 1,
    rightScore: 0,
    round: 2,
    maxRounds: 5,
    phase: "NORMAL",
  });
  assert.notEqual(envelope, null);
  const serialized = JSON.stringify(envelope);
  assert.equal(containsProhibitedValue(serialized), false);
  assert.ok(serialized.includes('"LEFT"') && serialized.includes('"RIGHT"'));
});

// ── 3. Sanitization ───────────────────────────────────────────────────────────

test("no synthetic raw identifier survives projection", () => {
  for (const instance of [PROOF_INSTANCE_A, PROOF_INSTANCE_B]) {
    const feed = projectProofFeed(instance, buildRawHostInputs(instance));
    assert.equal(projectedFeedIsSanitized(feed), true);
    assert.equal(containsProhibitedValue(JSON.stringify(feed.messages)), false);
    // The RAW side, by contrast, is deliberately id-keyed — proving the
    // projection is what removes the identifiers, not the fixture.
    assert.equal(containsProhibitedValue(JSON.stringify(buildRawHostInputs(instance))), true);
  }
});

test("the prohibited value/key detectors actually fire", () => {
  assert.equal(containsProhibitedValue(`{"a":"${MOCK_VIEWER_ID}"}`), true);
  assert.equal(containsProhibitedValue(`{"a":"${MOCK_OPPONENT_ID}"}`), true);
  assert.equal(containsProhibitedValue('{"a":"LEFT"}'), false);
  for (const key of PROHIBITED_EVIDENCE_KEYS) {
    assert.equal(containsProhibitedKey(`{"${key}":1}`), true, `${key} must be detected`);
  }
  assert.equal(containsProhibitedKey('{"sequence":1}'), false);
});

test("assertNoProhibitedValues throws on a leak and passes on clean data", () => {
  assert.throws(() => assertNoProhibitedValues({ viewer: MOCK_VIEWER_ID }));
  assert.throws(() => assertNoProhibitedValues({ token: "x" }));
  assert.doesNotThrow(() => assertNoProhibitedValues({ scoreValues: [0, 1] }));
});

test("evidence rows expose bounded fields only", () => {
  const applied = normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: PROOF_INSTANCE_A,
      sequence: 3,
      appliedEvent: "match_state_sync",
      round: 2,
      phase: "NORMAL",
      scoreValues: [1, 0],
      playerCount: 2,
    },
  });
  assert.notEqual(applied, null);
  const row = buildEvidenceRowFromAck(stepOf(4), applied!, "pass");
  const allowed = new Set([
    "step",
    "gate",
    "direction",
    "event",
    "protocolVersion",
    "matchInstanceId",
    "sequence",
    "result",
    "phase",
    "scoreValues",
    "playerCount",
    "appliedEvent",
    "rejectionReason",
    "hostState",
    "iframeCount",
    "status",
    "failureCategory",
  ]);
  for (const key of Object.keys(row)) {
    assert.ok(allowed.has(key), `unexpected evidence field: ${key}`);
  }
  assert.equal(containsProhibitedValue(JSON.stringify(row)), false);
  assert.equal(containsProhibitedKey(JSON.stringify(row)), false);
});

test("an acknowledgement matches only its own step", () => {
  const ack = normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: PROOF_INSTANCE_A,
      sequence: 3,
      appliedEvent: "match_state_sync",
      round: 2,
      phase: "NORMAL",
      scoreValues: [1, 0],
      playerCount: 2,
    },
  })!;
  assert.equal(acknowledgementMatches(stepOf(4), ack), true, "score order must not matter");
  assert.equal(acknowledgementMatches(stepOf(2), ack), false, "wrong sequence");
  assert.equal(acknowledgementMatches(stepOf(11), ack), false, "wrong instance");
});

test("a wrong scoreboard still fails even though ordering is ignored", () => {
  const ack = normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: PROOF_INSTANCE_A,
      sequence: 3,
      appliedEvent: "match_state_sync",
      round: 2,
      phase: "NORMAL",
      scoreValues: [0, 2],
      playerCount: 2,
    },
  })!;
  assert.equal(acknowledgementMatches(stepOf(4), ack), false);
});

test("a rejection matches only its expected reason", () => {
  const ack = normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_rejected",
    payload: {
      protocolVersion: 1,
      matchInstanceId: PROOF_INSTANCE_A,
      sequence: 3,
      rejectedEvent: "match_state_sync",
      reason: "stale_or_duplicate",
    },
  })!;
  assert.equal(acknowledgementMatches(stepOf(6), ack), true);
  assert.equal(acknowledgementMatches(stepOf(9), ack), false, "foreign_instance expected there");
});

test("a malformed acknowledgement is dropped entirely", () => {
  assert.equal(normalizeAcknowledgement({ type: "OTHER" }), null);
  assert.equal(normalizeAcknowledgement(null), null);
  assert.equal(
    normalizeAcknowledgement({
      type: "PENALTY444_UNITY_EVENT",
      event: "presentation_rejected",
      payload: { protocolVersion: 1, reason: "not_a_real_reason" },
    }),
    null,
  );
});

// ── Network classification ────────────────────────────────────────────────────

test("gameplay-authoritative paths are prohibited", () => {
  for (const path of [
    "wss://example.invalid/socket.io/",
    "/socket.io/?EIO=4",
    "https://something.railway.app/",
    "/api/wallet/balance",
    "/api/match/room/ABCD12",
    "/api/room/join",
    "/api/economy/payout",
  ]) {
    assert.equal(classifyNetworkPath(path), "prohibited", `${path} must be prohibited`);
  }
});

test("the expected proof paths classify safely", () => {
  assert.equal(classifyNetworkPath("/api/unity-cohort/status"), "cohort_status");
  assert.equal(classifyNetworkPath("/api/unity-cohort/session"), "cohort_session");
  assert.equal(classifyNetworkPath(REQUIRED_BUILD_URL), "protected_player_entry");
  assert.equal(
    classifyNetworkPath("/unity-arena/artifact/Build/penalty444.loader.js"),
    "protected_unity_artifact",
  );
  assert.equal(classifyNetworkPath("/_next/static/chunks/main.js"), "other_same_origin_static");
  // Query strings and fragments are stripped, never retained.
  assert.equal(classifyNetworkPath("/api/unity-cohort/status?x=1#y"), "cohort_status");
});

test("cross-origin URLs are prohibited unless they are the auth origin", () => {
  const page = "https://preview.example.invalid";
  const auth = "https://auth.example.invalid";
  assert.equal(classifyNetworkUrl(`${page}/api/unity-cohort/status`, page, auth), "cohort_status");
  assert.equal(classifyNetworkUrl(`${auth}/auth/v1/token`, page, auth), "third_party_auth");
  assert.equal(classifyNetworkUrl("https://cdn.example.invalid/x.js", page, auth), "prohibited");
  assert.equal(classifyNetworkUrl("wss://realtime.example.invalid", page, auth), "prohibited");
  assert.equal(classifyNetworkUrl(`${page}/api/match/state`, page, auth), "prohibited");
  // Unparseable or empty inputs are prohibited; a bare relative path is still
  // resolved against the page origin, which is the intended behaviour.
  assert.equal(classifyNetworkUrl("", page, null), "prohibited");
  assert.equal(classifyNetworkUrl("http://", page, null), "prohibited");
  assert.equal(classifyNetworkUrl(undefined, page, null), "prohibited");
  assert.equal(classifyNetworkUrl("/_next/static/x.js", page, null), "other_same_origin_static");
});

// ── Report ────────────────────────────────────────────────────────────────────

function passingRows(): ProofEvidenceRow[] {
  return PROOF_GATE_IDS.map((gate, index) =>
    buildHarnessEvidenceRow({
      step: { ...stepOf(1), step: index + 1, gate },
      status: "pass",
    }),
  );
}

test("a clean run reports pass and pins the baseline and route", () => {
  const report = buildProofReport({
    rows: passingRows(),
    maxIframeCount: 1,
    networkCategories: ["cohort_status", "cohort_session", "protected_player_entry"],
  });
  assert.equal(report.overall, "pass");
  assert.equal(report.baseline, PROOF_BASELINE_SHA);
  assert.equal(report.route, PROOF_ROUTE);
  assert.equal(report.gates.length, PROOF_GATE_IDS.length);
});

test("a missing gate leaves the run pending, never passing", () => {
  const rows = passingRows().slice(0, PROOF_GATE_IDS.length - 1);
  const report = buildProofReport({ rows, maxIframeCount: 1, networkCategories: [] });
  assert.equal(report.overall, "pending");
});

test("any gate failure, extra iframe or prohibited request fails the run", () => {
  const failing = passingRows();
  failing[0] = { ...failing[0], status: "fail", failureCategory: "timeout" };
  assert.equal(
    buildProofReport({ rows: failing, maxIframeCount: 1, networkCategories: [] }).overall,
    "fail",
  );
  assert.equal(
    buildProofReport({ rows: passingRows(), maxIframeCount: 2, networkCategories: [] }).overall,
    "fail",
  );
  assert.equal(
    buildProofReport({
      rows: passingRows(),
      maxIframeCount: 1,
      networkCategories: ["prohibited"],
    }).overall,
    "fail",
  );
});

test("classifyGate reports the first failure category and step count", () => {
  const rows = [
    buildHarnessEvidenceRow({ step: stepOf(1), status: "pass" }),
    buildHarnessEvidenceRow({
      step: stepOf(2),
      status: "fail",
      failureCategory: "missing_acknowledgement",
    }),
  ];
  const result = classifyGate("A_BOOTSTRAP", rows);
  assert.equal(result.status, "fail");
  assert.equal(result.failureCategory, "missing_acknowledgement");
  assert.equal(result.stepCount, 2);
});

test("a report that would leak refuses to be produced", () => {
  const leaky = {
    ...buildHarnessEvidenceRow({ step: stepOf(1), status: "pass" }),
    hostState: MOCK_VIEWER_ID,
  };
  assert.throws(() =>
    buildProofReport({ rows: [leaky], maxIframeCount: 1, networkCategories: [] }),
  );
});

test("outbound rows summarize the envelope without raw payload data", () => {
  const envelope = buildSanitizedNegativeEnvelope({
    matchInstanceId: PROOF_INSTANCE_B,
    sequence: 5,
    leftScore: 2,
    rightScore: 1,
    round: 3,
    maxRounds: 5,
    phase: "NORMAL",
  })!;
  const row = buildOutboundEvidenceRow(stepOf(14), envelope);
  assert.equal(row.direction, "react-to-unity");
  assert.deepEqual([...(row.scoreValues ?? [])], [1, 2]);
  assert.equal(row.playerCount, 2);
  assert.equal(row.status, "pending");
  assert.equal(containsProhibitedValue(JSON.stringify(row)), false);
});

// ── 4. Client integration source guards ───────────────────────────────────────

test("the client reuses the merged host and gate rather than reimplementing them", () => {
  assert.ok(
    /import UnityPresentationHost from "\.\.\/\.\.\/\.\.\/components\/match\/UnityPresentationHost"/.test(
      clientSource,
    ),
  );
  assert.ok(
    /import \{ useUnityPlayerFacingGate \} from "\.\.\/\.\.\/\.\.\/components\/match\/useUnityPlayerFacingGate"/.test(
      clientSource,
    ),
  );
  assert.ok(/<UnityPresentationHost/.test(clientCode), "the merged host must be mounted");
  assert.equal(count(clientCode, "<UnityPresentationHost"), 1, "exactly one host may mount");
  // No second renderer, coordinator, emitter or queue.
  assert.equal(clientCode.includes("MatchRenderer3D"), false);
  assert.equal(clientCode.includes("UnityPresentationShadowCoordinator"), false);
  assert.equal(clientCode.includes("PresentationSequenceEmitter"), false);
  assert.equal(clientCode.includes("ShadowDispatchQueue"), false);
});

test("the client requires all four public flags plus the protected build URL", () => {
  for (const flag of [
    "NEXT_PUBLIC_UNITY_MATCH_ENABLED",
    "NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED",
    "NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED",
    "NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED",
    "NEXT_PUBLIC_UNITY_BUILD_URL",
  ]) {
    assert.ok(clientSource.includes(flag), `missing flag ${flag}`);
  }
  assert.ok(/buildUrl === REQUIRED_BUILD_URL/.test(clientSource));
  assert.ok(
    /useUnityPlayerFacingGate\(\{ requested: preconditionsMet \}\)/.test(clientSource),
    "no network may be attempted before every precondition holds",
  );
});

test("the acknowledgement listener is strict about origin AND source", () => {
  assert.ok(/event\.origin !== window\.location\.origin/.test(clientSource));
  assert.ok(/event\.source !== frame\.contentWindow/.test(clientSource));
});

test("direct injection uses the explicit page origin, never a wildcard", () => {
  assert.ok(/postMessage\(envelope, window\.location\.origin\)/.test(clientSource));
  assert.equal(clientSource.includes('postMessage(envelope, "*")'), false);
  assert.equal(/postMessage\([^)]*,\s*"\*"\)/.test(clientSource), false);
});

test("every DOM query is scoped to the harness container", () => {
  // No unscoped document-level lookups.
  for (const forbidden of [
    "document.querySelector",
    "document.querySelectorAll",
    "document.getElementById",
    "document.getElementsByTagName",
  ]) {
    assert.equal(clientSource.includes(forbidden), false, `${forbidden} escapes the container`);
  }
  assert.ok(/root\.querySelectorAll\("iframe"\)/.test(clientSource));
  assert.ok(/containerRef/.test(clientSource));
});

test("the one-iframe invariant is observed and reported", () => {
  assert.ok(/new MutationObserver/.test(clientSource));
  assert.ok(/maxIframeRef/.test(clientSource));
  assert.ok(/maxIframeCount: maxIframeRef\.current/.test(clientSource));
  assert.ok(
    /found\.length === 1 \? found\[0\] : null/.test(clientSource),
    "a second iframe must make the proof iframe unresolvable",
  );
});

test("timeouts are bounded harness constants, never derived from input", () => {
  assert.ok(/const TIMEOUT_MS: Record<ProofStep\["timeoutLabel"\], number>/.test(clientSource));
  assert.equal(clientSource.includes("setInterval"), false, "no unbounded interval");
  assert.ok(/const deadline = Date\.now\(\) \+ timeoutMs/.test(clientSource));
});

test("the proof never starts on mount and never runs twice", () => {
  assert.ok(/startedRef/.test(clientSource));
  assert.ok(/if \(startedRef\.current\) return;/.test(clientSource));
  assert.ok(/onClick=\{\(\) => void runProof\(\)\}/.test(clientSource), "operator-initiated only");
});

test("the mock banner is unmissable and states the four required lines", () => {
  for (const line of [
    "B6D3C PROTECTED-PREVIEW MOCK PROOF",
    "MOCK EVENTS ONLY",
    "NO REAL MATCH",
    "PRODUCTION NO-GO",
  ]) {
    assert.ok(clientSource.includes(line), `banner must state: ${line}`);
  }
});

test("the harness renders no gameplay control of any kind", () => {
  // Exactly one control exists: the run button.
  assert.equal(count(clientSource, "<button"), 1, "only the run control may exist");
  for (const forbidden of ["Join", "Rematch", "Stake", "Deposit", "Withdraw", "onPick"]) {
    assert.equal(clientSource.includes(forbidden), false, `must not render ${forbidden}`);
  }
});

test("only categories are retained from observed requests", () => {
  assert.ok(/classifyNetworkUrl\(entry\.name, pageOrigin, authOrigin\)/.test(clientSource));
  assert.ok(/networkRef\.current\.add\(/.test(clientSource));
  // The raw URL is never stored or rendered.
  assert.equal(/setNetwork\w*\(\s*entry\.name/.test(clientSource), false);
});

test("the pure module touches no browser, network, socket or environment API", () => {
  for (const forbidden of [
    "process.env",
    "window.",
    "document.",
    "fetch(",
    "localStorage",
    "sessionStorage",
    "postMessage",
    "WebSocket",
    "import(",
    "require(",
    "setTimeout",
    "setInterval",
  ]) {
    assert.equal(proofCode.includes(forbidden), false, `pure module must not use ${forbidden}`);
  }
  assert.equal(proofCode.includes('"use client"'), false);
  assert.equal(/from ["']react["']/.test(proofCode), false, "the pure module must not import React");
  // It also must not read the clock: the plan has to be identical on every call.
  assert.equal(/Date\.now|new Date|Math\.random/.test(proofCode), false);
});

test("PROHIBITED_VALUES covers exactly the two synthetic identifiers", () => {
  assert.deepEqual([...PROHIBITED_VALUES], [MOCK_VIEWER_ID, MOCK_OPPONENT_ID]);
  assert.notEqual(MOCK_VIEWER_ID, MOCK_OPPONENT_ID);
  for (const id of PROHIBITED_VALUES) {
    assert.ok(id.startsWith("b6d3c-mock-"), "synthetic ids must be self-describing");
  }
});
