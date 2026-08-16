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
  FALLBACK_OBSERVATION_KEYS,
  GATE_C_SNAPSHOTS,
  SAFE_FAILURE_CATEGORIES,
  SAFE_REJECT_REASONS,
  acknowledgementMatches,
  assertNoProhibitedValues,
  buildEvidenceRowFromAck,
  buildFallbackEvidenceRow,
  buildHarnessEvidenceRow,
  buildOutboundEvidenceRow,
  buildProofReport,
  buildRawHostInputs,
  buildRawRoundResult,
  buildRawStateSync,
  buildSanitizedNegativeEnvelope,
  buildSnapshotEvidenceRows,
  classifyGate,
  classifyNetworkPath,
  classifyNetworkUrl,
  containsProhibitedKey,
  containsProhibitedValue,
  entryIsInsideProofWindow,
  fallbackObservationPassed,
  findSnapshotAck,
  isSafeRejectReason,
  normalizeAcknowledgement,
  normalizeSentSummary,
  projectProofFeed,
  projectedFeedIsSanitized,
  proofStepOrderIsValid,
  sentSummaryMatches,
  verifyPerEnvelopeSnapshots,
  type FallbackObservation,
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
    "suddenDeathRound",
    "playerCount",
    "appliedEvent",
    "rejectionReason",
    "hostState",
    "iframeCount",
    "fallback",
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
    "/wallet",
    "/api/match/room/ABCD12",
    "/match/ABCD12",
    "/api/match/state",
    "/api/room/join",
    "/room/ABCD12",
    "/api/economy/payout",
    "/pick/lane",
    "/api/pick/submit",
  ]) {
    assert.equal(classifyNetworkPath(path), "prohibited", `${path} must be prohibited`);
  }
});

test("Next static chunks remain other_same_origin_static even when names contain match", () => {
  assert.equal(
    classifyNetworkPath("/_next/static/chunks/app-match-abc123.js"),
    "other_same_origin_static",
  );
  assert.equal(
    classifyNetworkPath("/_next/static/chunks/main-app.js"),
    "other_same_origin_static",
  );
  assert.equal(classifyNetworkPath("/favicon.ico"), "other_same_origin_static");
  assert.equal(classifyNetworkPath("/_next/static/chunks/main.js"), "other_same_origin_static");
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
  assert.equal(classifyNetworkUrl(`${page}/wallet`, page, auth), "prohibited");
  assert.equal(classifyNetworkUrl(`${page}/socket.io/?EIO=4`, page, auth), "prohibited");
  assert.equal(
    classifyNetworkUrl(`${page}/_next/static/chunks/app-match-x.js`, page, auth),
    "other_same_origin_static",
  );
  // Unparseable or empty inputs are prohibited; a bare relative path is still
  // resolved against the page origin, which is the intended behaviour.
  assert.equal(classifyNetworkUrl("", page, null), "prohibited");
  assert.equal(classifyNetworkUrl("http://", page, null), "prohibited");
  assert.equal(classifyNetworkUrl(undefined, page, null), "prohibited");
  assert.equal(classifyNetworkUrl("/_next/static/x.js", page, null), "other_same_origin_static");
});

test("exact Vercel Live Preview feedback is preview_platform_tooling", () => {
  const page = "https://preview.example.invalid";
  const auth = "https://auth.example.invalid";
  assert.equal(
    classifyNetworkUrl("https://vercel.live/_next-live/feedback/feedback.js", page, auth),
    "preview_platform_tooling",
  );
  assert.equal(
    classifyNetworkUrl("https://vercel.live/_next-live/feedback/index.html", page, auth),
    "preview_platform_tooling",
  );
  assert.equal(
    classifyNetworkUrl("https://vercel.live/_next-live/feedback/foo.js?x=1", page, auth),
    "preview_platform_tooling",
  );
  assert.equal(
    classifyNetworkUrl("https://vercel.live/_next-live/feedback/foo/bar.js#frag", page, auth),
    "preview_platform_tooling",
  );
});

test("lookalike and non-feedback vercel.live traffic remains prohibited", () => {
  const page = "https://preview.example.invalid";
  const auth = "https://auth.example.invalid";
  for (const url of [
    "https://evil.vercel.live/_next-live/feedback/foo.js",
    "https://vercel.live.evil.example/_next-live/feedback/foo.js",
    "https://www.vercel.live/_next-live/feedback/foo.js",
    "https://vercel.live/_next-live/other/foo.js",
    "https://vercel.live/",
    "https://vercel.live/anything-else",
    "http://vercel.live/_next-live/feedback/foo.js",
    "wss://vercel.live/_next-live/feedback/socket",
    "https://vercel.app/x",
    "https://vercel.com/x",
  ]) {
    assert.equal(classifyNetworkUrl(url, page, auth), "prohibited", `${url} must stay prohibited`);
  }
});

test("Railway, unknown third-party, wss, match, and socket.io stay prohibited", () => {
  const page = "https://preview.example.invalid";
  assert.equal(
    classifyNetworkUrl("https://something.railway.app/socket.io/", page, null),
    "prohibited",
  );
  assert.equal(classifyNetworkUrl("https://cdn.example.invalid/x.js", page, null), "prohibited");
  assert.equal(classifyNetworkUrl("http://cdn.example.invalid/x.js", page, null), "prohibited");
  assert.equal(classifyNetworkUrl("wss://realtime.example.invalid", page, null), "prohibited");
  assert.equal(classifyNetworkUrl(`${page}/match/ABCD12`, page, null), "prohibited");
  assert.equal(classifyNetworkUrl(`${page}/socket.io/?EIO=4`, page, null), "prohibited");
});

test("preview_platform_tooling is retained and does not fail the network gate", () => {
  const report = buildProofReport({
    rows: passingRows(),
    maxIframeCount: 1,
    networkCategories: ["preview_platform_tooling", "other_same_origin_static"],
  });
  assert.equal(report.overall, "pass");
  assert.ok(report.networkCategories.includes("preview_platform_tooling"));
  assert.equal(report.networkCategories.includes("prohibited"), false);
});

test("preview_platform_tooling plus a prohibited request still fails the network gate", () => {
  const report = buildProofReport({
    rows: passingRows(),
    maxIframeCount: 1,
    networkCategories: ["preview_platform_tooling", "prohibited"],
  });
  assert.equal(report.overall, "fail");
  assert.ok(report.networkCategories.includes("preview_platform_tooling"));
  assert.ok(report.networkCategories.includes("prohibited"));
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
  // An outbound row is only ever retained AFTER confirmation, so the default
  // status is `pass` — a pending outbound row must never reach the report.
  assert.equal(row.status, "pass");
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
    /useUnityPlayerFacingGate,?\s*[\s\S]{0,120}?\} from "\.\.\/\.\.\/\.\.\/components\/match\/useUnityPlayerFacingGate"/.test(
      clientSource,
    ),
    "the merged gate must be imported from the merged module",
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
    /useUnityPlayerFacingGate\(\{\s*requested: preconditionsMet && operatorRequested,/.test(
      clientCode,
    ),
    "no network may be attempted before the operator starts the run",
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
  assert.ok(
    /const B6D3C_UNITY_READY_TIMEOUT_MS = 90_000/.test(clientSource),
    "proof renderer override must be 90s",
  );
  assert.ok(/load:\s*95_000/.test(clientSource), "Gate A load wait must be 95s");
  assert.ok(/short:\s*1_500/.test(clientSource));
  assert.ok(/standard:\s*6_000/.test(clientSource));
  assert.ok(
    /readyTimeoutMs=\{B6D3C_UNITY_READY_TIMEOUT_MS\}/.test(clientSource),
    "proof host must receive the proof-only ready bound",
  );
  // Harness wait must remain greater than the proof renderer timeout.
  assert.equal(90_000 < 95_000, true);
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
  // Exactly two controls exist: run, and local reset.
  assert.equal(count(clientCode, "<button"), 2, "only run and reset controls may exist");
  assert.ok(clientCode.includes("Run mock proof"));
  assert.ok(clientCode.includes("Reset local proof state"));
  for (const forbidden of ["Join", "Rematch", "Stake", "Deposit", "Withdraw", "onPick"]) {
    assert.equal(clientCode.includes(forbidden), false, `must not render ${forbidden}`);
  }
  // Fallback induction stays automatic — no manual fallback control.
  assert.equal(/>\s*Induce/.test(clientCode), false, "no manual fallback button");
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

// ── 5. Correction regressions: operator initiation ────────────────────────────

test("no cohort request and no renderer may begin before the operator acts", () => {
  // The gate is requested only when the operator has started the run.
  assert.ok(
    /useUnityPlayerFacingGate\(\{\s*requested: preconditionsMet && operatorRequested,/.test(
      clientCode,
    ),
    "the cohort hook must also require operatorRequested",
  );
  // Both initiation flags start false, so mount performs no request and mounts
  // no iframe.
  assert.ok(/const \[operatorRequested, setOperatorRequested\] = useState\(false\)/.test(clientCode));
  assert.ok(/const \[proofActivated, setProofActivated\] = useState\(false\)/.test(clientCode));
  // An authorized gate alone is NOT sufficient to activate the host.
  assert.ok(
    /const playerFacingAuthorized =\s*operatorRequested && proofActivated && gate === "authorized"/.test(
      clientCode,
    ),
    "host activation must require operator + activation + authorized",
  );
  assert.ok(/playerFacingAuthorized=\{playerFacingAuthorized\}/.test(clientCode));
  // The only place activation is turned on is inside the run flow.
  assert.equal(count(clientCode, "setProofActivated(true)"), 1);
  assert.equal(count(clientCode, "setOperatorRequested(true)"), 1);
});

test("a denied gate stays React-only and never starts the proof", () => {
  assert.ok(/gateRef\.current !== "authorized"/.test(clientCode));
  assert.ok(/failureCategory: resolved \? "gate_denied" : "timeout"/.test(clientCode));
  assert.ok(SAFE_FAILURE_CATEGORIES.includes("gate_denied"));
  // The denial path returns before activation.
  const denialIndex = clientCode.indexOf('gateRef.current !== "authorized"');
  const activateIndex = clientCode.indexOf("setProofActivated(true)");
  assert.ok(denialIndex > 0 && activateIndex > 0);
  assert.ok(denialIndex < activateIndex, "the denial check must precede activation");
});

test("the ready baseline is captured BEFORE the host is activated", () => {
  const baselineIndex = clientCode.indexOf("const readyBaseline = readyCountRef.current");
  const activateIndex = clientCode.indexOf("setProofActivated(true)");
  assert.ok(baselineIndex > 0, "a ready baseline must be recorded");
  assert.ok(baselineIndex < activateIndex, "the baseline must precede activation");
  // Step 1 requires a ready event produced after that baseline.
  assert.ok(/readyCountRef\.current > readyBaseline/.test(clientCode));
});

test("the run verifies preconditions before doing anything", () => {
  assert.ok(/if \(!preconditionsMet\) return;/.test(clientCode));
  assert.ok(/if \(startedRef\.current\) return;/.test(clientCode));
  // Clearing happens before the gate is requested.
  const clearIndex = clientCode.indexOf("clearProofState();");
  const requestIndex = clientCode.indexOf("setOperatorRequested(true)");
  assert.ok(clearIndex > 0 && clearIndex < requestIndex);
});

// ── Reset ─────────────────────────────────────────────────────────────────────

test("reset deactivates the host, clears everything and re-keys the host", () => {
  const reset = /const resetProof = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/.exec(
    clientCode,
  );
  assert.ok(reset, "a reset control must exist");
  const body = reset[0];
  assert.ok(/if \(running\) return;/.test(body), "reset must be inert during a run");
  assert.ok(/stopNetworkObservation\(\)/.test(body));
  assert.ok(/setProofActivated\(false\)/.test(body));
  assert.ok(/setOperatorRequested\(false\)/.test(body));
  assert.ok(/setActiveInstance\(PROOF_INSTANCE_A\)/.test(body));
  assert.ok(/setIdentity\(feedA\.identity\)/.test(body));
  assert.ok(/setHostMessages\(\[\]\)/.test(body));
  assert.ok(/clearProofState\(\)/.test(body));
  assert.ok(/startedRef\.current = false/.test(body), "the one-run guard must be cleared");
  assert.ok(/setProofRunEpoch\(\(epoch\) => epoch \+ 1\)/.test(body));
  // The host is keyed by the epoch so a prior terminal fallback cannot survive.
  assert.ok(/key=\{proofRunEpoch\}/.test(clientCode));
  assert.ok(/disabled=\{running\}/.test(clientCode), "reset must be disabled while running");
});

test("clearProofState resets every accumulator the report reads", () => {
  const clear = /const clearProofState = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/.exec(clientCode);
  assert.ok(clear);
  const body = clear[0];
  for (const line of [
    "rowsRef.current = []",
    "ackLogRef.current = []",
    "sentLogRef.current = []",
    "readyCountRef.current = 0",
    "maxIframeRef.current = 0",
    "networkRef.current = new Set()",
    "networkStartRef.current = null",
    "harnessFaultRef.current = false",
  ]) {
    assert.ok(body.includes(line), `clearProofState must reset: ${line}`);
  }
});

// ── Evidence-row lifecycle ────────────────────────────────────────────────────

test("the merged host onMessageSent callback is wired and is not a no-op", () => {
  assert.ok(
    /onMessageSent=\{handleMessageSent\}/.test(clientCode),
    "the host's send confirmation must be consumed",
  );
  assert.equal(
    /onMessageSent=\{\(\) => \{\}\}/.test(clientCode),
    false,
    "onMessageSent must not be a no-op",
  );
  assert.ok(/normalizeSentSummary\(summary\)/.test(clientCode));
  assert.ok(/sentLogRef\.current\.push\(snapshot\)/.test(clientCode));
  assert.ok(
    /sentSummaryMatches\(item\.message, sentLogRef\.current\[i\]\)/.test(clientCode),
    "a host dispatch must wait for its own send confirmation",
  );
});

test("a host dispatch retains rows only after BOTH confirmation and acknowledgement", () => {
  const send = /const sendViaHost = useCallback\([\s\S]*?\n  \);/.exec(clientCode);
  assert.ok(send);
  const body = send[0];
  const confirmIndex = body.indexOf("const confirmed = await waitUntil");
  const ackIndex = body.indexOf("const ack = await findAck");
  const outboundIndex = body.indexOf("pushRow(buildOutboundEvidenceRow");
  assert.ok(confirmIndex > 0 && ackIndex > confirmIndex);
  assert.ok(outboundIndex > ackIndex, "the outbound row must be retained last");
  assert.ok(/failureCategory: "missing_send_confirmation"/.test(body));
  assert.ok(/buildOutboundEvidenceRow\(step, item\.message, "pass"\)/.test(body));
  assert.ok(/buildEvidenceRowFromAck\(step, ack, "pass"\)/.test(body));
});

test("no pending row is ever pushed into the retained evidence", () => {
  assert.equal(
    /pushRow\([^)]*"pending"/.test(clientCode),
    false,
    "a pending row must never reach rowsRef",
  );
  assert.equal(
    /buildOutboundEvidenceRow\([^)]*"pending"\)/.test(clientCode),
    false,
    "outbound rows are never retained as pending",
  );
  // A transient UI-only indicator is allowed, but it is separate state.
  assert.ok(/setPendingStep\(/.test(clientCode));
  assert.equal(/rowsRef\.current[^\n]*pendingStep/.test(clientCode), false);
});

test("outbound pass plus inbound pass classifies the gate as pass", () => {
  const envelope = buildSanitizedNegativeEnvelope({
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 1,
    leftScore: 0,
    rightScore: 0,
    round: 1,
    maxRounds: 5,
    phase: "NORMAL",
  })!;
  const ack = normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: PROOF_INSTANCE_A,
      sequence: 1,
      appliedEvent: "match_state_sync",
      round: 1,
      phase: "NORMAL",
      scoreValues: [0, 0],
      playerCount: 2,
    },
  })!;
  const rows = [
    buildOutboundEvidenceRow(stepOf(2), envelope, "pass"),
    buildEvidenceRowFromAck(stepOf(2), ack, "pass"),
  ];
  const result = classifyGate("A_BOOTSTRAP", rows);
  assert.equal(result.status, "pass");
  assert.equal(result.stepCount, 2);
});

test("a missing send confirmation or acknowledgement fails the gate", () => {
  for (const category of ["missing_send_confirmation", "missing_acknowledgement"] as const) {
    const rows = [buildHarnessEvidenceRow({ step: stepOf(2), status: "fail", failureCategory: category })];
    const result = classifyGate("A_BOOTSTRAP", rows);
    assert.equal(result.status, "fail");
    assert.equal(result.failureCategory, category);
    assert.ok(SAFE_FAILURE_CATEGORIES.includes(category));
  }
});

test("send summaries are normalized to bounded values and match by identity", () => {
  const envelope = buildSanitizedNegativeEnvelope({
    matchInstanceId: PROOF_INSTANCE_B,
    sequence: 5,
    leftScore: 2,
    rightScore: 1,
    round: 3,
    maxRounds: 5,
    phase: "NORMAL",
  })!;
  const snapshot = normalizeSentSummary({
    messageId: `${PROOF_INSTANCE_B}:5:match_state_sync`,
    event: "match_state_sync",
    matchInstanceId: PROOF_INSTANCE_B,
    sequence: 5,
  })!;
  // The message id is deliberately dropped.
  assert.deepEqual(Object.keys(snapshot).sort(), ["event", "matchInstanceId", "sequence"]);
  assert.equal(sentSummaryMatches(envelope, snapshot), true);
  assert.equal(
    sentSummaryMatches(envelope, { ...snapshot, sequence: 4 }),
    false,
    "a different sequence must not match",
  );
  assert.equal(
    sentSummaryMatches(envelope, { ...snapshot, matchInstanceId: PROOF_INSTANCE_A }),
    false,
  );
  assert.equal(normalizeSentSummary(null), null);
  assert.equal(normalizeSentSummary({ event: "" }), null);
});

// ── Gate C: runtime score snapshots ───────────────────────────────────────────

function appliedAck(
  sequence: number,
  scoreValues: number[],
  instance: string = PROOF_INSTANCE_A,
) {
  return normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: instance,
      sequence,
      appliedEvent: "match_state_sync",
      round: sequence,
      phase: "NORMAL",
      scoreValues,
      playerCount: scoreValues.length,
    },
  })!;
}

test("gate C names the two exact runtime snapshots", () => {
  assert.equal(GATE_C_SNAPSHOTS.length, 2);
  assert.deepEqual(
    GATE_C_SNAPSHOTS.map((s) => [s.matchInstanceId, s.sequence, [...s.scoreValues]]),
    [
      [PROOF_INSTANCE_A, 1, [0, 0]],
      [PROOF_INSTANCE_A, 3, [0, 1]],
    ],
  );
});

test("gate C passes only on the acknowledged per-envelope scores", () => {
  const good = [appliedAck(1, [0, 0]), appliedAck(3, [1, 0])];
  const result = verifyPerEnvelopeSnapshots(good);
  assert.equal(result.passed, true, "score order must not matter");
  assert.equal(result.checks.length, 2);
  assert.ok(result.checks.every((c) => c.found && c.scoresMatch));
});

test("gate C fails when the bootstrap was overwritten by the live scores", () => {
  // The exact PR-2 defect: the bootstrap reports the LATER scoreboard.
  const bad = [appliedAck(1, [1, 0]), appliedAck(3, [1, 0])];
  const result = verifyPerEnvelopeSnapshots(bad);
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].found, true);
  assert.equal(result.checks[0].scoresMatch, false);
});

test("gate C fails when a snapshot acknowledgement is missing entirely", () => {
  const result = verifyPerEnvelopeSnapshots([appliedAck(1, [0, 0])]);
  assert.equal(result.passed, false);
  assert.equal(result.checks[1].found, false);
});

test("gate C ignores the wrong instance, event kind and rejections", () => {
  assert.equal(findSnapshotAck([appliedAck(1, [0, 0], PROOF_INSTANCE_B)], GATE_C_SNAPSHOTS[0]), null);
  const rejection = normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_rejected",
    payload: { protocolVersion: 1, matchInstanceId: PROOF_INSTANCE_A, sequence: 1, reason: "apply_failed" },
  })!;
  assert.equal(findSnapshotAck([rejection], GATE_C_SNAPSHOTS[0]), null);
});

test("gate C emits one acknowledgement-derived evidence row per snapshot", () => {
  const rows = buildSnapshotEvidenceRows(stepOf(5), [appliedAck(1, [0, 0]), appliedAck(3, [1, 0])]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === "pass"));
  assert.ok(rows.every((r) => r.gate === "C_PER_ENVELOPE_SCORES"));
  assert.deepEqual(
    rows.map((r) => [r.sequence, [...(r.scoreValues ?? [])]]),
    [
      [1, [0, 0]],
      [3, [1, 0]],
    ],
    "both distinct scoreboards must be visibly recorded",
  );
  const failing = buildSnapshotEvidenceRows(stepOf(5), [appliedAck(1, [1, 0]), appliedAck(3, [1, 0])]);
  assert.equal(failing[0].status, "fail");
  assert.equal(failing[0].failureCategory, "unexpected_outcome");
});

test("the client proves gate C from acknowledgements, not from visibility", () => {
  assert.ok(/buildSnapshotEvidenceRows\(step\(5\), ackLogRef\.current\)/.test(clientCode));
  assert.ok(/verifyPerEnvelopeSnapshots\(ackLogRef\.current\)/.test(clientCode));
  assert.ok(
    /observe\(5, snapshots\.passed && hostVisible, "unexpected_outcome"\)/.test(clientCode),
    "host visibility must be an ADDITIONAL requirement, not a substitute",
  );
  assert.ok(/readHostState\(\) === "UNITY_READY_VISIBLE" && iframes\(\)\.length === 1/.test(clientCode));
});

// ── suddenDeathRound ──────────────────────────────────────────────────────────

test("step 10 requires the exact suddenDeathRound", () => {
  const step = stepOf(10);
  assert.equal(step.expect.kind, "applied");
  if (step.expect.kind === "applied") {
    assert.equal(step.expect.phase, "SUDDEN_DEATH");
    assert.equal(step.expect.suddenDeathRound, 1);
    assert.deepEqual([...(step.expect.scoreValues ?? [])], [3, 3]);
  }
});

function suddenDeathAck(suddenDeathRound: number | undefined) {
  const payload: Record<string, unknown> = {
    protocolVersion: 1,
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 4,
    appliedEvent: "match_state_sync",
    round: 6,
    phase: "SUDDEN_DEATH",
    scoreValues: [3, 3],
    playerCount: 2,
  };
  if (suddenDeathRound !== undefined) payload.suddenDeathRound = suddenDeathRound;
  return normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload,
  })!;
}

test("suddenDeathRound is matched positively and negatively", () => {
  assert.equal(acknowledgementMatches(stepOf(10), suddenDeathAck(1)), true);
  assert.equal(acknowledgementMatches(stepOf(10), suddenDeathAck(2)), false, "wrong round");
  assert.equal(acknowledgementMatches(stepOf(10), suddenDeathAck(0)), false, "wrong round");
  assert.equal(
    acknowledgementMatches(stepOf(10), suddenDeathAck(undefined)),
    false,
    "an absent suddenDeathRound must not satisfy an explicit expectation",
  );
});

test("suddenDeathRound is retained in sanitized evidence and displayed", () => {
  const row = buildEvidenceRowFromAck(stepOf(10), suddenDeathAck(1), "pass");
  assert.equal(row.suddenDeathRound, 1);
  assert.equal(containsProhibitedValue(JSON.stringify(row)), false);
  // Absent on a normal sync.
  assert.equal(buildEvidenceRowFromAck(stepOf(2), appliedAck(1, [0, 0]), "pass").suddenDeathRound, null);
  // Outbound rows carry it too, straight from the envelope.
  const outbound = buildOutboundEvidenceRow(stepOf(10), validateEnvelope({
    type: "PENALTY444_MATCH_EVENT",
    protocolVersion: 1,
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 4,
    event: "match_state_sync",
    payload: {
      scores: { LEFT: 3, RIGHT: 3 },
      round: 6,
      maxRounds: 5,
      phase: "SUDDEN_DEATH",
      suddenDeathRound: 1,
    },
  })!);
  assert.equal(outbound.suddenDeathRound, 1);
  // And it is a bounded numeric column in the table.
  assert.ok(/\{row\.suddenDeathRound \?\? "—"\}/.test(clientCode));
  assert.ok(clientCode.includes("sdRound"));
});

// ── Fail-open ─────────────────────────────────────────────────────────────────

function fallbackAllTrue(): FallbackObservation {
  return {
    hostTerminal: true,
    iframeCountZero: true,
    unityUnderlayPresent: true,
    proofUnderlayPresent: true,
    underlayVisible: true,
    unitySlotAbsent: true,
    noUnavailableCard: true,
    stableNoRemount: true,
    instanceStillTerminal: true,
  };
}

test("the fallback contract cannot pass from host state and iframe count alone", () => {
  assert.equal(fallbackObservationPassed(fallbackAllTrue()), true);
  // Terminal + zero iframes, but every other requirement violated in turn.
  for (const key of FALLBACK_OBSERVATION_KEYS) {
    if (key === "hostTerminal" || key === "iframeCountZero") continue;
    const broken = { ...fallbackAllTrue(), [key]: false };
    assert.equal(
      fallbackObservationPassed(broken),
      false,
      `${key} must be required even when the host is terminal with zero iframes`,
    );
    assert.equal(broken.hostTerminal, true);
    assert.equal(broken.iframeCountZero, true);
  }
});

test("the fallback evidence row records every boolean and fails on any false", () => {
  const pass = buildFallbackEvidenceRow(stepOf(15), fallbackAllTrue(), "UNITY_FAILED_REACT_FALLBACK", 0);
  assert.equal(pass.status, "pass");
  assert.equal(pass.gate, "I_FAIL_OPEN");
  assert.deepEqual(Object.keys(pass.fallback ?? {}).sort(), [...FALLBACK_OBSERVATION_KEYS].sort());
  assert.equal(containsProhibitedValue(JSON.stringify(pass)), false);
  assert.equal(containsProhibitedKey(JSON.stringify(pass)), false);

  const fail = buildFallbackEvidenceRow(
    stepOf(15),
    { ...fallbackAllTrue(), underlayVisible: false },
    "UNITY_FAILED_REACT_FALLBACK",
    0,
  );
  assert.equal(fail.status, "fail");
  assert.equal(fail.failureCategory, "unexpected_outcome");
  assert.equal(classifyGate("I_FAIL_OPEN", [fail]).status, "fail");
});

test("the client observes the complete fallback DOM contract", () => {
  for (const probe of [
    '"[data-unity-underlay]"',
    '"[data-b6d3c-underlay]"',
    '"[data-unity-slot]"',
    '"3D preview unavailable"',
    "opacity-100",
    "opacity-0",
    "FALLBACK_STABILITY_MS",
  ]) {
    assert.ok(clientCode.includes(probe), `the fallback observation must probe ${probe}`);
  }
  assert.ok(/buildFallbackEvidenceRow\(step\(15\), fallback/.test(clientCode));
  assert.ok(/if \(!fallbackObservationPassed\(fallback\)\) throw/.test(clientCode));
});

// ── Harness fault + network window ────────────────────────────────────────────

test("a harness fault always forces overall failure", () => {
  const rows = passingRows();
  const clean = buildProofReport({ rows, maxIframeCount: 1, networkCategories: [] });
  assert.equal(clean.overall, "pass");
  assert.equal(clean.harnessFault, false);

  const faulted = buildProofReport({
    rows,
    maxIframeCount: 1,
    networkCategories: [],
    harnessFault: true,
  });
  assert.equal(faulted.overall, "fail", "a harness fault can never report a pass");
  assert.equal(faulted.harnessFault, true);
});

test("a pending row can never appear in a passing report", () => {
  const rows = [...passingRows()];
  rows[0] = { ...rows[0], status: "pending" };
  const report = buildProofReport({ rows, maxIframeCount: 1, networkCategories: [] });
  assert.notEqual(report.overall, "pass");
  assert.equal(report.rows.some((r) => r.status === "pending"), true);
  // A clean report has none.
  const clean = buildProofReport({ rows: passingRows(), maxIframeCount: 1, networkCategories: [] });
  assert.equal(clean.overall, "pass");
  assert.equal(clean.rows.some((r) => r.status === "pending"), false);
});

test("a realistic complete 16-step evidence set reaches overall PASS", () => {
  const rows: ProofEvidenceRow[] = [];
  const push = (row: ProofEvidenceRow) => rows.push(row);

  const hostPair = (n: number, envelope: ReturnType<typeof buildSanitizedNegativeEnvelope>, ack: ReturnType<typeof normalizeAcknowledgement>) => {
    push(buildOutboundEvidenceRow(stepOf(n), envelope!, "pass"));
    push(buildEvidenceRowFromAck(stepOf(n), ack!, "pass"));
  };
  const sync = (instance: string, sequence: number, left: number, right: number, round: number) =>
    buildSanitizedNegativeEnvelope({
      matchInstanceId: instance,
      sequence,
      leftScore: left,
      rightScore: right,
      round,
      maxRounds: 5,
      phase: "NORMAL",
    });
  const rejection = (sequence: number, reason: string) =>
    normalizeAcknowledgement({
      type: "PENALTY444_UNITY_EVENT",
      event: "presentation_rejected",
      payload: {
        protocolVersion: 1,
        matchInstanceId: PROOF_INSTANCE_A,
        sequence,
        rejectedEvent: "match_state_sync",
        reason,
      },
    });

  // 1 ready
  push(buildHarnessEvidenceRow({ step: stepOf(1), status: "pass", hostState: "UNITY_LOADING", iframeCount: 1 }));
  // 2 bootstrap
  hostPair(2, sync(PROOF_INSTANCE_A, 1, 0, 0, 1), appliedAck(1, [0, 0]));
  // 3 round_result
  push(buildOutboundEvidenceRow(stepOf(3), validateEnvelope({
    type: "PENALTY444_MATCH_EVENT",
    protocolVersion: 1,
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 2,
    event: "round_result",
    payload: { round: 1, kickerLane: "LEFT", keeperLane: "RIGHT", result: "GOAL" },
  })!, "pass"));
  push(buildEvidenceRowFromAck(stepOf(3), normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_applied",
    payload: {
      protocolVersion: 1,
      matchInstanceId: PROOF_INSTANCE_A,
      sequence: 2,
      appliedEvent: "round_result",
      round: 1,
      result: "GOAL",
    },
  })!, "pass"));
  // 4 authoritative sync
  hostPair(4, sync(PROOF_INSTANCE_A, 3, 1, 0, 2), appliedAck(3, [1, 0]));
  // 5 gate C snapshots + host observation
  for (const row of buildSnapshotEvidenceRows(stepOf(5), [appliedAck(1, [0, 0]), appliedAck(3, [1, 0])])) {
    push(row);
  }
  push(buildHarnessEvidenceRow({ step: stepOf(5), status: "pass", hostState: "UNITY_READY_VISIBLE", iframeCount: 1 }));
  // 6/7 duplicate + stale
  hostPair(6, sync(PROOF_INSTANCE_A, 3, 1, 0, 2), rejection(3, "stale_or_duplicate"));
  hostPair(7, sync(PROOF_INSTANCE_A, 2, 0, 0, 1), rejection(2, "stale_or_duplicate"));
  // 8 adapter drop
  push(buildHarnessEvidenceRow({ step: stepOf(8), status: "pass", hostState: "UNITY_READY_VISIBLE", iframeCount: 1 }));
  // 9 foreign
  hostPair(9, sync(PROOF_FOREIGN_INSTANCE, 5, 9, 9, 4), normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_rejected",
    payload: { protocolVersion: 1, reason: "foreign_instance" },
  }));
  // 10 sudden death
  push(buildOutboundEvidenceRow(stepOf(10), validateEnvelope({
    type: "PENALTY444_MATCH_EVENT",
    protocolVersion: 1,
    matchInstanceId: PROOF_INSTANCE_A,
    sequence: 4,
    event: "match_state_sync",
    payload: { scores: { LEFT: 3, RIGHT: 3 }, round: 6, maxRounds: 5, phase: "SUDDEN_DEATH", suddenDeathRound: 1 },
  })!, "pass"));
  push(buildEvidenceRowFromAck(stepOf(10), suddenDeathAck(1), "pass"));
  // 11 transition
  hostPair(11, sync(PROOF_INSTANCE_B, 1, 0, 0, 1), appliedAck(1, [0, 0], PROOF_INSTANCE_B));
  // 12 superseded
  hostPair(12, sync(PROOF_INSTANCE_A, 9, 4, 4, 7), normalizeAcknowledgement({
    type: "PENALTY444_UNITY_EVENT",
    event: "presentation_rejected",
    payload: { protocolVersion: 1, reason: "foreign_instance" },
  }));
  // 13 reload
  push(buildHarnessEvidenceRow({ step: stepOf(13), status: "pass", hostState: "UNITY_READY_VISIBLE", iframeCount: 1 }));
  // 14 post-reload bootstrap
  hostPair(14, sync(PROOF_INSTANCE_B, 5, 1, 2, 3), appliedAck(5, [1, 2], PROOF_INSTANCE_B));
  // 15 fail-open
  push(buildFallbackEvidenceRow(stepOf(15), fallbackAllTrue(), "UNITY_FAILED_REACT_FALLBACK", 0));
  // 16 sanitization
  push(buildHarnessEvidenceRow({ step: stepOf(16), status: "pass", hostState: "UNITY_FAILED_REACT_FALLBACK", iframeCount: 0 }));

  const report = buildProofReport({
    rows,
    maxIframeCount: 1,
    networkCategories: ["cohort_status", "cohort_session", "protected_player_entry", "other_same_origin_static"],
    harnessFault: false,
  });
  assert.equal(report.overall, "pass", "a realistic complete run must be able to PASS");
  assert.equal(report.rows.some((r) => r.status === "pending"), false, "no pending rows");
  assert.ok(report.gates.every((g) => g.status === "pass"), "every gate must pass");
  assert.equal(containsProhibitedValue(JSON.stringify(report)), false);
});

test("network observation is operator-started and window-filtered", () => {
  // Pre-run entries are ignored.
  assert.equal(entryIsInsideProofWindow(100, 200), false);
  assert.equal(entryIsInsideProofWindow(200, 200), true);
  assert.equal(entryIsInsideProofWindow(300, 200), true);
  // No proof start recorded ⇒ nothing may be observed.
  assert.equal(entryIsInsideProofWindow(300, null), false);
  assert.equal(entryIsInsideProofWindow("300", 200), false);
  assert.equal(entryIsInsideProofWindow(Number.NaN, 200), false);
});

test("the client starts observation at the press, before the cohort requests", () => {
  const startIndex = clientCode.indexOf("if (!startNetworkObservation())");
  const requestIndex = clientCode.indexOf("setOperatorRequested(true)");
  assert.ok(startIndex > 0, "observation must be started inside the run");
  assert.ok(startIndex < requestIndex, "observation must precede the cohort requests");
  assert.ok(/networkStartRef\.current = startedAt/.test(clientCode));
  assert.ok(
    /entryIsInsideProofWindow\(entry\.startTime, networkStartRef\.current\)/.test(clientCode),
    "buffered pre-run entries must be filtered out",
  );
  // Never started merely on mount.
  assert.equal(
    /useEffect\(\(\) => \{\s*if \(typeof PerformanceObserver/.test(clientCode),
    false,
    "observation must not begin on mount",
  );
});

test("the observer is disconnected after completion, on reset and on unmount", () => {
  assert.ok(/const finalize = \(\) => \{\s*stopNetworkObservation\(\)/.test(clientCode));
  assert.ok(/const resetProof = useCallback\(\(\) => \{\s*if \(running\) return;\s*stopNetworkObservation\(\)/.test(clientCode));
  assert.ok(/useEffect\(\(\) => stopNetworkObservation, \[stopNetworkObservation\]\)/.test(clientCode));
  assert.ok(/observer\.disconnect\(\)/.test(clientCode));
});

test("an unavailable PerformanceObserver is a bounded failure, not silent success", () => {
  assert.ok(/failureCategory: "network_observation_unavailable"/.test(clientCode));
  assert.ok(/harnessFaultRef\.current = true/.test(clientCode));
  assert.ok(SAFE_FAILURE_CATEGORIES.includes("network_observation_unavailable"));
});

test("an unexpected exception records a bounded row AND sets the report flag", () => {
  assert.ok(/failureCategory: "harness_error"/.test(clientCode), "an explicit row must be added");
  assert.ok(/harnessFault: harnessFaultRef\.current/.test(clientCode), "and the report flag set");
  assert.ok(/activeStepRef/.test(clientCode), "the active step must be known in the catch");
});

// ── 6. B6D3C cohort-gate diagnostic surfacing ─────────────────────────────────

test("the harness passes the OPTIONAL bounded diagnostic sink into the merged gate", () => {
  assert.ok(
    /useUnityPlayerFacingGate\(\{\s*requested: preconditionsMet && operatorRequested,\s*onDiagnostic: setCohortDiagnostic,\s*\}\)/.test(
      clientCode,
    ),
    "the existing hook call must gain only the optional onDiagnostic sink",
  );
  // Still exactly one gate call — diagnostics must not add a second resolution.
  assert.equal(count(clientCode, "useUnityPlayerFacingGate({"), 1);
  assert.ok(
    /type UnityPlayerFacingGateDiagnostic/.test(clientCode),
    "only the bounded enum type is imported",
  );
});

test("only the bounded enum is stored and rendered — never a value", () => {
  assert.ok(
    /useState<UnityPlayerFacingGateDiagnostic \| null>\(/.test(clientCode),
    "the stored diagnostic must be the bounded enum or null",
  );
  assert.ok(
    /cohort diagnostic: \{cohortDiagnostic \?\? "none"\}/.test(clientCode),
    "the operator line must render the enum, defaulting to a safe placeholder",
  );
  // Nothing identity- or credential-shaped may be rendered anywhere.
  for (const forbidden of [
    "access_token",
    "accessToken",
    "Authorization",
    "Bearer",
    "document.cookie",
    "getSession()",
    "supabase",
    "UNITY_COHORT_SIGNING_SECRET",
    "UNITY_COHORT_EMAILS",
  ]) {
    assert.equal(clientCode.includes(forbidden), false, `must not surface ${forbidden}`);
  }
  // No free-form error text is rendered.
  assert.equal(/\{[^}]*\.message\}/.test(clientCode), false, "no exception text may be rendered");
});

test("reset and a new run both clear the displayed diagnostic", () => {
  const clear = /const clearProofState = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/.exec(clientCode);
  assert.ok(clear);
  assert.ok(
    /setCohortDiagnostic\(null\)/.test(clear[0]),
    "clearProofState must reset the diagnostic to its initial safe state",
  );
  // Reset routes through clearProofState…
  const reset = /const resetProof = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/.exec(clientCode);
  assert.ok(reset && /clearProofState\(\)/.test(reset[0]));
  // …and so does the start of a run, so no stale value survives into a new run.
  const runStart = clientCode.indexOf("startedRef.current = true;");
  const clearInRun = clientCode.indexOf("clearProofState();", runStart);
  assert.ok(runStart > 0 && clearInRun > runStart, "a run must clear before it begins");
  // The only writer besides the gate sink is that reset.
  assert.equal(count(clientCode, "setCohortDiagnostic(null)"), 1);
});

test("the diagnostic is supplemental only — the proof contract is untouched", () => {
  // Gate list, step count and the failing-gate semantics are unchanged.
  assert.equal(PROOF_STEPS.length, 16);
  assert.equal(PROOF_GATE_IDS.length, 10);
  assert.ok(/failureCategory: resolved \? "gate_denied" : "timeout"/.test(clientCode));
  // The diagnostic never feeds the report or any evidence row. Scope the check to
  // buildProofReport's own argument object, not the remainder of the file.
  const reportCall = /buildProofReport\(\{[\s\S]*?\}\)/.exec(clientCode);
  assert.ok(reportCall, "the report must still be built");
  assert.equal(
    reportCall[0].includes("cohortDiagnostic"),
    false,
    "the diagnostic must never enter the report",
  );
  assert.equal(/pushRow\([^)]*cohortDiagnostic/.test(clientCode), false);
  assert.equal(
    /buildHarnessEvidenceRow\([^)]*cohortDiagnostic/.test(clientCode),
    false,
    "the diagnostic must never enter an evidence row",
  );
});
