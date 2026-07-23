/**
 * B6D3B streaming feasibility harness — security/gating tests.
 * Runs on Node `node:test` via `tsx`. No network, no artifact body.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  constantTimeEqual,
  extractBearerToken,
  validateArtifactOrigin,
  isSafePathSegment,
  resolveAllowlistedRecord,
  evaluateGate,
  type ProofEnv,
  type GateInput,
} from "./security";

const WASM_SEGMENTS = ["Build", "b6b-local-fb840878-d.wasm.gz"];
const BEARER = "s3cr3t-proof-bearer-value";

function baseEnv(overrides: Partial<ProofEnv> = {}): ProofEnv {
  return {
    VERCEL_ENV: "preview",
    UNITY_STREAM_PROOF_ENABLED: "true",
    UNITY_STREAM_PROOF_BEARER: BEARER,
    UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: "http://127.0.0.1:5599",
    ...overrides,
  };
}

function baseGate(overrides: Partial<GateInput> = {}): GateInput {
  return {
    env: baseEnv(),
    authHeader: `Bearer ${BEARER}`,
    transport: "raw",
    pathSegments: WASM_SEGMENTS,
    originOptions: { allowHttp: true },
    ...overrides,
  };
}

// ── constant-time compare ───────────────────────────────────────────────────
test("constantTimeEqual: equal values succeed", () => {
  assert.equal(constantTimeEqual(BEARER, BEARER), true);
});

test("constantTimeEqual: unequal same-length values fail", () => {
  const a = "abcdefghij";
  const b = "abcdefghiX";
  assert.equal(a.length, b.length);
  assert.equal(constantTimeEqual(a, b), false);
});

test("constantTimeEqual: unequal-length values fail safely", () => {
  assert.equal(constantTimeEqual("short", "a-much-longer-value"), false);
  assert.equal(constantTimeEqual("", "x"), false);
});

// ── bearer extraction (no query-string / cookie auth) ───────────────────────
test("extractBearerToken accepts canonical Bearer header only", () => {
  assert.equal(extractBearerToken(`Bearer ${BEARER}`), BEARER);
  assert.equal(extractBearerToken("Bearer "), null);
  assert.equal(extractBearerToken("Bearer"), null);
  assert.equal(extractBearerToken("bearer x"), null); // scheme case
  assert.equal(extractBearerToken("Basic abc"), null);
  assert.equal(extractBearerToken("Bearer a b"), null); // whitespace in token
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken(undefined), null);
});

// ── origin validation ───────────────────────────────────────────────────────
test("validateArtifactOrigin: https accepted and normalized", () => {
  assert.equal(validateArtifactOrigin("https://cdn.example.com"), "https://cdn.example.com");
  assert.equal(validateArtifactOrigin("https://cdn.example.com/"), "https://cdn.example.com");
  assert.equal(validateArtifactOrigin("https://cdn.example.com:8443"), "https://cdn.example.com:8443");
});

test("validateArtifactOrigin: http rejected unless loopback + allowHttp", () => {
  assert.equal(validateArtifactOrigin("http://cdn.example.com"), null);
  assert.equal(validateArtifactOrigin("http://cdn.example.com", { allowHttp: true }), null);
  assert.equal(validateArtifactOrigin("http://127.0.0.1:5599", { allowHttp: true }), "http://127.0.0.1:5599");
  assert.equal(validateArtifactOrigin("http://localhost:5599", { allowHttp: true }), "http://localhost:5599");
  assert.equal(validateArtifactOrigin("http://127.0.0.1:5599"), null); // needs allowHttp
});

test("validateArtifactOrigin: rejects creds/query/fragment/path/garbage", () => {
  assert.equal(validateArtifactOrigin("https://user:pass@cdn.example.com"), null);
  assert.equal(validateArtifactOrigin("https://cdn.example.com?x=1"), null);
  assert.equal(validateArtifactOrigin("https://cdn.example.com#frag"), null);
  assert.equal(validateArtifactOrigin("https://cdn.example.com/path"), null);
  assert.equal(validateArtifactOrigin("not-a-url"), null);
  assert.equal(validateArtifactOrigin(""), null);
  assert.equal(validateArtifactOrigin(undefined), null);
  assert.equal(validateArtifactOrigin("ftp://cdn.example.com"), null);
});

// ── path safety ─────────────────────────────────────────────────────────────
test("isSafePathSegment rejects traversal/encoding/separators/nul", () => {
  assert.equal(isSafePathSegment("Build"), true);
  assert.equal(isSafePathSegment("b6b-local-fb840878-d.wasm.gz"), true);
  for (const bad of [
    "",
    ".",
    "..",
    "%2e%2e",
    "%252e%252e",
    "a\\b",
    "%5c",
    "a/b",
    "C:",
    "a:b",
    "a\0b",
    "a b",
    "café", // non-ascii
    "http:",
  ]) {
    assert.equal(isSafePathSegment(bad), false, `expected unsafe: ${JSON.stringify(bad)}`);
  }
});

test("resolveAllowlistedRecord: exact allowlist only", () => {
  assert.equal(resolveAllowlistedRecord(WASM_SEGMENTS)?.label, "wasm");
  assert.equal(resolveAllowlistedRecord(["Build", "b6b-local-fb840878-d.data.gz"])?.label, "data");

  // denials
  assert.equal(resolveAllowlistedRecord([]), null);
  assert.equal(resolveAllowlistedRecord(["Build", "unknown.gz"]), null);
  assert.equal(resolveAllowlistedRecord(["..", "b6b-local-fb840878-d.wasm.gz"]), null);
  assert.equal(resolveAllowlistedRecord(["Build", "%2e%2e", "b6b-local-fb840878-d.wasm.gz"]), null);
  assert.equal(resolveAllowlistedRecord(["Build", "%252e%252e"]), null);
  assert.equal(resolveAllowlistedRecord(["Build\\x", "b6b-local-fb840878-d.wasm.gz"]), null);
  assert.equal(resolveAllowlistedRecord(["%5c", "b6b-local-fb840878-d.wasm.gz"]), null);
  assert.equal(resolveAllowlistedRecord(["https://evil", "x"]), null);
  assert.equal(resolveAllowlistedRecord(["", "Build", "b6b-local-fb840878-d.wasm.gz"]), null);
  assert.equal(resolveAllowlistedRecord(["C:", "b6b-local-fb840878-d.wasm.gz"]), null);
  assert.equal(resolveAllowlistedRecord(["Build", "b6b-local-fb840878-d.wasm.gz\0"]), null);
  assert.equal(resolveAllowlistedRecord(["build", "b6b-local-fb840878-d.wasm.gz"]), null); // case
  assert.equal(resolveAllowlistedRecord(["Build", "b6b-local-fb840878-d.wasm.gz", "extra"]), null);
});

// ── gating order ────────────────────────────────────────────────────────────
test("evaluateGate: allow path returns record + origin + transport", () => {
  const g = evaluateGate(baseGate());
  assert.equal(g.ok, true);
  if (g.ok) {
    assert.equal(g.transport, "raw");
    assert.equal(g.origin, "http://127.0.0.1:5599");
    assert.equal(g.record.label, "wasm");
  }
});

test("evaluateGate: production denied first", () => {
  const g = evaluateGate(baseGate({ env: baseEnv({ VERCEL_ENV: "production" }) }));
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.reason, "production");
});

test("evaluateGate: disabled denied", () => {
  const g = evaluateGate(baseGate({ env: baseEnv({ UNITY_STREAM_PROOF_ENABLED: undefined }) }));
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.reason, "disabled");
});

test("evaluateGate: missing bearer env denied", () => {
  const g = evaluateGate(baseGate({ env: baseEnv({ UNITY_STREAM_PROOF_BEARER: undefined }) }));
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.reason, "bearer_env_missing");
});

test("evaluateGate: missing/malformed/invalid Authorization denied", () => {
  const missing = evaluateGate(baseGate({ authHeader: null }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "authorization_missing_or_malformed");

  const malformed = evaluateGate(baseGate({ authHeader: "Basic xyz" }));
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.reason, "authorization_missing_or_malformed");

  const wrong = evaluateGate(baseGate({ authHeader: "Bearer wrong-value" }));
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.reason, "bearer_mismatch");
});

test("evaluateGate: missing/invalid origin denied", () => {
  const missing = evaluateGate(baseGate({ env: baseEnv({ UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: undefined }) }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "origin_missing_or_invalid");

  const invalid = evaluateGate(baseGate({ env: baseEnv({ UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: "http://evil.example.com" }) }));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, "origin_missing_or_invalid");
});

test("evaluateGate: unknown transport denied", () => {
  const g = evaluateGate(baseGate({ transport: "websocket" }));
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.reason, "transport_unknown");
});

test("evaluateGate: path not allowlisted denied", () => {
  const g = evaluateGate(baseGate({ pathSegments: ["..", "secret"] }));
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.reason, "path_not_allowlisted");
});
