/**
 * B6D3B streaming feasibility harness — proof route tests.
 * Runs on Node `node:test` via `tsx`. Loopback mock upstream only; no internet,
 * no Vercel, no real artifact body.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { GET, HEAD } from "./route";

const WASM_PATH = ["Build", "b6b-local-fb840878-d.wasm.gz"];
const WASM_PATH_STR = WASM_PATH.join("/");
const BEARER = "proof-bearer-abcdefghijklmnop";
const MOCK = Buffer.from("HELLO-WASMGZ");

const ENV_KEYS = [
  "VERCEL_ENV",
  "UNITY_STREAM_PROOF_ENABLED",
  "UNITY_STREAM_PROOF_BEARER",
  "UNITY_STREAM_PROOF_ARTIFACT_ORIGIN",
] as const;

function applyEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): () => void {
  const prior = new Map<string, string | undefined>();
  for (const k of ENV_KEYS) prior.set(k, process.env[k]);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const k of ENV_KEYS) {
      const v = prior.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

async function startUpstream(handler: (res: ServerResponse) => void) {
  const server = createServer((_req, res) => handler(res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function ctx(transport: string, path: string[]) {
  return { params: Promise.resolve({ transport, path }) };
}
function req(transport: string, pathStr: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/dev/unity-stream-proof/${transport}/${pathStr}`, { headers });
}

function baseEnabledEnv(origin: string) {
  return applyEnv({
    VERCEL_ENV: "preview",
    UNITY_STREAM_PROOF_ENABLED: "true",
    UNITY_STREAM_PROOF_BEARER: BEARER,
    UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: origin,
  });
}

// ── gating → indistinguishable 404 ──────────────────────────────────────────
test("route: production returns opaque 404", async () => {
  const restore = applyEnv({
    VERCEL_ENV: "production",
    UNITY_STREAM_PROOF_ENABLED: "true",
    UNITY_STREAM_PROOF_BEARER: BEARER,
    UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: "https://cdn.example.com",
  });
  try {
    const res = await GET(req("raw", WASM_PATH_STR, { authorization: `Bearer ${BEARER}` }), ctx("raw", WASM_PATH));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    restore();
  }
});

test("route: every gate failure yields an identical opaque 404", async () => {
  const cases: Array<() => () => void> = [
    () => applyEnv({ VERCEL_ENV: "production", UNITY_STREAM_PROOF_ENABLED: "true", UNITY_STREAM_PROOF_BEARER: BEARER, UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: "https://cdn.example.com" }),
    () => applyEnv({ VERCEL_ENV: "preview", UNITY_STREAM_PROOF_ENABLED: undefined, UNITY_STREAM_PROOF_BEARER: BEARER, UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: "https://cdn.example.com" }),
    () => applyEnv({ VERCEL_ENV: "preview", UNITY_STREAM_PROOF_ENABLED: "true", UNITY_STREAM_PROOF_BEARER: undefined, UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: "https://cdn.example.com" }),
    () => applyEnv({ VERCEL_ENV: "preview", UNITY_STREAM_PROOF_ENABLED: "true", UNITY_STREAM_PROOF_BEARER: BEARER, UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: undefined }),
    () => applyEnv({ VERCEL_ENV: "preview", UNITY_STREAM_PROOF_ENABLED: "true", UNITY_STREAM_PROOF_BEARER: BEARER, UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: "http://evil.example.com" }),
  ];
  const snapshots: Array<{ status: number; body: string; ct: string | null }> = [];
  for (const setup of cases) {
    const restore = setup();
    try {
      const res = await GET(req("raw", WASM_PATH_STR, { authorization: `Bearer ${BEARER}` }), ctx("raw", WASM_PATH));
      snapshots.push({ status: res.status, body: await res.text(), ct: res.headers.get("content-type") });
    } finally {
      restore();
    }
  }
  // also: missing/invalid auth and unknown transport / bad path
  const restore = baseEnabledEnv("https://cdn.example.com");
  try {
    for (const r of [
      await GET(req("raw", WASM_PATH_STR, {}), ctx("raw", WASM_PATH)), // no auth
      await GET(req("raw", WASM_PATH_STR, { authorization: "Basic x" }), ctx("raw", WASM_PATH)), // malformed
      await GET(req("raw", WASM_PATH_STR, { authorization: "Bearer wrong" }), ctx("raw", WASM_PATH)), // invalid
      await GET(req("ws", WASM_PATH_STR, { authorization: `Bearer ${BEARER}` }), ctx("ws", WASM_PATH)), // transport
      await GET(req("raw", "..%2fsecret", { authorization: `Bearer ${BEARER}` }), ctx("raw", ["..", "secret"])), // path
    ]) {
      snapshots.push({ status: r.status, body: await r.text(), ct: r.headers.get("content-type") });
    }
  } finally {
    restore();
  }
  const first = snapshots[0];
  for (const s of snapshots) {
    assert.equal(s.status, 404);
    assert.equal(s.body, first.body);
    assert.equal(s.ct, first.ct);
  }
});

// ── happy path (raw + real wasm allowlist path) ─────────────────────────────
test("route: raw wasm streams with sanitized success headers", async () => {
  const up = await startUpstream((res) => {
    res.writeHead(200, {
      "content-encoding": "gzip",
      server: "nginx",
      "set-cookie": "sid=1",
      "x-powered-by": "Express",
    });
    res.end(MOCK);
  });
  const restore = baseEnabledEnv(up.origin);
  try {
    const res = await GET(req("raw", WASM_PATH_STR, { authorization: `Bearer ${BEARER}` }), ctx("raw", WASM_PATH));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/wasm");
    assert.equal(res.headers.get("content-encoding"), "gzip");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("vary"), "Authorization");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("server"), null);
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("location"), null);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.equals(MOCK));
  } finally {
    restore();
    await up.close();
  }
});

test("route: HEAD returns headers and no body", async () => {
  const up = await startUpstream((res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end();
  });
  const restore = baseEnabledEnv(up.origin);
  try {
    const res = await HEAD(req("raw", WASM_PATH_STR, { authorization: `Bearer ${BEARER}` }), ctx("raw", WASM_PATH));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/wasm");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.length, 0);
  } finally {
    restore();
    await up.close();
  }
});

// ── boundary regression: harness must not touch runtime domains ─────────────
test("boundary: harness sources import no forbidden modules", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const libDir = fileURLToPath(new URL("../../../../../../lib/unity-stream-proof/", import.meta.url));
  const files = [
    `${here}route.ts`,
    `${libDir}manifest.ts`,
    `${libDir}security.ts`,
    `${libDir}streamProxy.ts`,
  ];
  const forbidden = [
    "MatchRoomPanel",
    "MatchRenderer3D",
    "UnityPresentationHost",
    "useViewerPresentation",
    "unityPresentationAdapter",
    "unityPresentationShadow",
    "unityPresentationIdentity",
    "unityPresentationCorrelation",
    "realtime-server",
    "packages/shared",
    "@shared",
    "unity-arena",
    "socket.io",
    "@supabase",
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // only inspect import/require lines to avoid matching prose in comments
    const importLines = src.split("\n").filter((l) => /\b(import|require)\b/.test(l) && /["']/.test(l));
    for (const bad of forbidden) {
      for (const line of importLines) {
        assert.equal(line.includes(bad), false, `${f} must not import ${bad}: ${line.trim()}`);
      }
    }
  }
});
