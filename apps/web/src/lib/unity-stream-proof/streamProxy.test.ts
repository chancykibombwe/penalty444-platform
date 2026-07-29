/**
 * B6D3B streaming feasibility harness — stream proxy transport tests.
 * Runs on Node `node:test` via `tsx`. Uses in-process loopback HTTP mock
 * servers only. No internet, no Vercel, no real artifact body.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

import {
  fetchTransport,
  rawTransport,
  buildStreamHeaders,
  build416Headers,
  buildUpstreamArtifactPath,
  type Diagnostics,
  type ProxyOutcome,
  type RawClientRequestLike,
} from "./streamProxy";
import { EXPECTED_RELEASE_ID, loadProofManifest, type ArtifactRecord } from "./manifest";
import { validateArtifactOrigin } from "./security";

type Handler = (reqUrl: string, req: IncomingMessage, res: ServerResponse) => void;

async function startServer(handler: Handler): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => handler(req.url ?? "/", req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function gzipRecord(over: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    label: "wasm",
    path: "Build/mock.wasm.gz",
    bytes: 12,
    sha256: "0".repeat(64),
    contentEncoding: "gzip",
    contentType: "application/wasm",
    ...over,
  };
}

function identityRecord(over: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    label: "loader",
    path: "Build/mock.loader.js",
    bytes: 12,
    sha256: "0".repeat(64),
    contentEncoding: "identity",
    contentType: "application/javascript",
    ...over,
  };
}

const MOCK = Buffer.from("HELLO-WASMGZ"); // 12 bytes, deterministic
const MOCK_SHA = createHash("sha256").update(MOCK).digest("hex");

function assertStream(o: ProxyOutcome): asserts o is Extract<ProxyOutcome, { kind: "stream" }> {
  assert.equal(o.kind, "stream");
}
function assertError(o: ProxyOutcome): asserts o is Extract<ProxyOutcome, { kind: "error" }> {
  assert.equal(o.kind, "error");
}

// ── RAW transport: happy path & headers ─────────────────────────────────────
test("raw: preserves exact compressed bytes, count and client-side SHA", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-type": "x/ignored", "content-encoding": "gzip", "content-length": String(MOCK.length) });
    res.end(MOCK);
  });
  try {
    const diags: Diagnostics[] = [];
    const record = gzipRecord({ bytes: MOCK.length });
    const outcome = await rawTransport({ origin: s.origin, record, method: "GET", onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    assert.equal(outcome.status, 200);
    assert.equal(outcome.headers.get("content-type"), "application/wasm");
    assert.equal(outcome.headers.get("content-encoding"), "gzip");
    assert.equal(outcome.headers.get("content-length"), String(MOCK.length));
    const body = await drain(outcome.body!);
    assert.equal(body.length, MOCK.length);
    assert.ok(body.equals(MOCK));
    assert.equal(createHash("sha256").update(body).digest("hex"), MOCK_SHA);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "complete");
    assert.equal(diags[0].totalBytes, MOCK.length);
    assert.equal(diags[0].transport, "raw");
  } finally {
    await s.close();
  }
});

test("raw: strips unsafe upstream headers", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, {
      "content-encoding": "gzip",
      server: "nginx/1.2",
      "set-cookie": "sid=abc",
      location: "https://evil",
      "x-powered-by": "Express",
      via: "1.1 vegur",
      "cache-control": "public, max-age=999",
      etag: '"abc123"',
    });
    res.end(MOCK);
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "GET" });
    assertStream(outcome);
    for (const h of ["server", "set-cookie", "location", "x-powered-by", "via", "etag"]) {
      assert.equal(outcome.headers.get(h), null, `expected ${h} stripped`);
    }
    assert.equal(outcome.headers.get("cache-control"), "private, no-store");
    assert.equal(outcome.headers.get("vary"), "Authorization");
    assert.equal(outcome.headers.get("x-content-type-options"), "nosniff");
    await outcome.body?.cancel();
  } finally {
    await s.close();
  }
});

test("raw: absent Accept-Ranges stays absent (never fabricated)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(MOCK.length) });
    res.end(MOCK);
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "GET" });
    assertStream(outcome);
    assert.equal(outcome.headers.get("accept-ranges"), null);
    await outcome.body?.cancel();
  } finally {
    await s.close();
  }
});

test("raw: gzip record with missing/wrong encoding fails closed", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" }); // no content-encoding
    res.end(MOCK);
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "GET", onDiagnostics: (d) => diags.push(d) });
    assertError(outcome);
    assert.equal(outcome.reason, "header_mismatch");
    assert.equal(diags[0].reason, "header_mismatch");
  } finally {
    await s.close();
  }
});

test("raw: full Content-Length mismatch fails closed before streaming (byte_mismatch)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": "999" });
    res.end(MOCK);
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "GET", onDiagnostics: (d) => diags.push(d) });
    assertError(outcome);
    assert.equal(outcome.reason, "byte_mismatch");
    assert.equal(diags[0].reason, "byte_mismatch");
  } finally {
    await s.close();
  }
});

test("raw: completed byte-count mismatch reflected in diagnostics", async () => {
  const s = await startServer((_u, _req, res) => {
    // No Content-Length declared; body is shorter than the pinned record size.
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end(MOCK); // 12 bytes
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: 100 }), method: "GET", onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    await drain(outcome.body!);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "byte_mismatch");
    assert.equal(diags[0].totalBytes, MOCK.length);
  } finally {
    await s.close();
  }
});

test("raw: delayed multi-chunk stays streamed; first chunk before completion", async () => {
  let secondChunkSent = false;
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.write(Buffer.from("first")); // 5
    setTimeout(() => {
      secondChunkSent = true;
      res.write(Buffer.from("second")); // 6
      res.end();
    }, 120);
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: 11 }), method: "GET" });
    assertStream(outcome);
    const reader = outcome.body!.getReader();
    const first = await reader.read();
    assert.equal(secondChunkSent, false, "first chunk must arrive before upstream completes");
    assert.ok(first.value && first.value.byteLength > 0);
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    assert.equal(secondChunkSent, true);
  } finally {
    await s.close();
  }
});

test("raw: rejects upstream redirect", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(302, { location: "https://evil.example.com/x" });
    res.end();
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET", onDiagnostics: (d) => diags.push(d) });
    assertError(outcome);
    assert.equal(outcome.reason, "redirect_rejected");
    assert.equal(diags[0].reason, "redirect_rejected");
  } finally {
    await s.close();
  }
});

// ── RAW transport: distinct timeout phases ──────────────────────────────────
test("raw: connect timeout via injected request (deterministic)", async () => {
  // Injected request never emits 'socket' and never calls the response cb.
  const neverConnect: RawClientRequestLike = {
    on() {
      return this;
    },
    destroy() {},
    end() {},
  };
  const diags: Diagnostics[] = [];
  const outcome = await rawTransport(
    { origin: "http://127.0.0.1:1", record: gzipRecord(), method: "GET", timeouts: { connectMs: 60, headersMs: 5000, bodyMs: 5000 }, onDiagnostics: (d) => diags.push(d) },
    { request: () => neverConnect },
  );
  assertError(outcome);
  assert.equal(outcome.reason, "connect_timeout");
  assert.equal(outcome.status, 504);
  assert.equal(diags[0].reason, "connect_timeout");
});

test("raw: headers timeout (connects, never responds)", async () => {
  const s = await startServer(() => {
    /* accept connection, never send headers */
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET", timeouts: { connectMs: 5000, headersMs: 80, bodyMs: 5000 }, onDiagnostics: (d) => diags.push(d) });
    assertError(outcome);
    assert.equal(outcome.reason, "headers_timeout");
    assert.equal(outcome.status, 504);
    assert.equal(diags[0].reason, "headers_timeout");
  } finally {
    await s.close();
  }
});

test("raw: body timeout after first chunk (stall)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.write(Buffer.from("first"));
    // never write more, never end → body stalls
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: 100 }), method: "GET", timeouts: { connectMs: 5000, headersMs: 5000, bodyMs: 80 }, onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    const reader = outcome.body!.getReader();
    const first = await reader.read();
    assert.ok(first.value && first.value.byteLength > 0);
    await assert.rejects(async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    });
    assert.equal(diags[0].reason, "body_timeout");
  } finally {
    await s.close();
  }
});

test("raw: successful completion cleans up (no later timer, single emission)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(MOCK.length) });
    res.end(MOCK);
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "GET", timeouts: { connectMs: 5000, headersMs: 5000, bodyMs: 60 }, onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    const body = await drain(outcome.body!);
    assert.ok(body.equals(MOCK));
    await sleep(150); // longer than bodyMs — no late body_timeout may fire
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "complete");
  } finally {
    await s.close();
  }
});

test("raw: HEAD returns headers and no body", async () => {
  const s = await startServer((_u, req, res) => {
    assert.equal(req.method, "HEAD");
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(MOCK.length) });
    res.end();
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "HEAD" });
    assertStream(outcome);
    assert.equal(outcome.body, null);
    assert.equal(outcome.headers.get("content-type"), "application/wasm");
  } finally {
    await s.close();
  }
});

test("raw: Range forwarded; 206 + Content-Range preserved", async () => {
  const s = await startServer((_u, req, res) => {
    assert.equal(req.headers["range"], "bytes=0-4");
    res.writeHead(206, {
      "content-encoding": "gzip",
      "content-range": "bytes 0-4/12",
      "content-length": "5",
      "accept-ranges": "bytes",
    });
    res.end(MOCK.subarray(0, 5));
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "GET", range: "bytes=0-4" });
    assertStream(outcome);
    assert.equal(outcome.status, 206);
    assert.equal(outcome.headers.get("content-range"), "bytes 0-4/12");
    assert.equal(outcome.headers.get("content-length"), "5");
    assert.equal(outcome.headers.get("accept-ranges"), "bytes");
    const body = await drain(outcome.body!);
    assert.equal(body.length, 5);
  } finally {
    await s.close();
  }
});

test("raw: 416 preserves safe Content-Range, empty body, no upstream body forwarded", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(416, { "content-range": "bytes */12", "content-encoding": "gzip" });
    res.end("UPSTREAM-ERROR-PAGE"); // must NOT be forwarded
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET", range: "bytes=999-1000" });
    assertStream(outcome);
    assert.equal(outcome.status, 416);
    assert.equal(outcome.body, null);
    assert.equal(outcome.headers.get("content-range"), "bytes */12");
    assert.equal(outcome.headers.get("content-encoding"), null);
    assert.equal(outcome.headers.get("content-length"), null);
  } finally {
    await s.close();
  }
});

// ── RAW transport: abort ────────────────────────────────────────────────────
test("raw: pre-aborted client signal denied as client_abort", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end(MOCK);
  });
  try {
    const ac = new AbortController();
    ac.abort();
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET", signal: ac.signal });
    assertError(outcome);
    assert.equal(outcome.reason, "client_abort");
  } finally {
    await s.close();
  }
});

test("raw: mid-stream client abort destroys upstream (diagnostics client_abort)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.write(Buffer.from("chunk-1"));
    const t = setInterval(() => {
      res.write(Buffer.from("x"));
    }, 30);
    res.on("close", () => clearInterval(t));
  });
  try {
    const diags: Diagnostics[] = [];
    const ac = new AbortController();
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: 100 }), method: "GET", signal: ac.signal, onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    const reader = outcome.body!.getReader();
    const first = await reader.read();
    assert.ok(first.value && first.value.byteLength > 0);
    ac.abort();
    await assert.rejects(async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    });
    assert.equal(diags[0]?.reason, "client_abort");
  } finally {
    await s.close();
  }
});

// ── FETCH transport ─────────────────────────────────────────────────────────
test("fetch: identity artifact streams without explicit buffering", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-type": "x/ignored", "content-length": String(MOCK.length) });
    res.end(MOCK);
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord({ bytes: MOCK.length }), method: "GET", onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    assert.equal(outcome.status, 200);
    assert.equal(outcome.headers.get("content-type"), "application/javascript");
    assert.equal(outcome.headers.get("content-encoding"), "identity");
    const body = await drain(outcome.body!);
    assert.ok(body.equals(MOCK));
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "complete");
  } finally {
    await s.close();
  }
});

test("fetch: gzip artifact fails closed on detectable decompression", async () => {
  // Undici transparently decompresses gzip and drops content-encoding, so a
  // gzip artifact whose response no longer advertises gzip must fail closed.
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(MOCK);
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await fetchTransport({ origin: s.origin, record: gzipRecord(), method: "GET", onDiagnostics: (d) => diags.push(d) });
    assertError(outcome);
    assert.equal(outcome.reason, "header_mismatch");
    assert.equal(diags[0].reason, "header_mismatch");
  } finally {
    await s.close();
  }
});

test("fetch: gzip response omits Content-Length (build headers rule)", () => {
  // Deterministic unit-level check: even when a gzip upstream declares a length,
  // fetch must omit Content-Length because the body may be transformed.
  const upstream = new Headers({ "content-encoding": "gzip", "content-length": "8583356" });
  const built = buildStreamHeaders({ transport: "fetch", status: 200, record: gzipRecord({ bytes: 8583356 }), upstream });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.headers.get("content-encoding"), "gzip");
    assert.equal(built.headers.get("content-length"), null);
  }
  // Raw, by contrast, echoes a matching full length.
  const rawBuilt = buildStreamHeaders({ transport: "raw", status: 200, record: gzipRecord({ bytes: 8583356 }), upstream });
  assert.equal(rawBuilt.ok, true);
  if (rawBuilt.ok) assert.equal(rawBuilt.headers.get("content-length"), "8583356");
});

test("build416Headers: safe Content-Range, no encoding/length/type", () => {
  const h = build416Headers(new Headers({ "content-range": "bytes */12", "content-encoding": "gzip", "content-length": "10" }));
  assert.equal(h.get("content-range"), "bytes */12");
  assert.equal(h.get("content-encoding"), null);
  assert.equal(h.get("content-length"), null);
  assert.equal(h.get("content-type"), null);
  assert.equal(h.get("cache-control"), "private, no-store");
});

test("fetch: rejects upstream redirect", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(302, { location: "https://evil.example.com/x" });
    res.end();
  });
  try {
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord(), method: "GET" });
    assertError(outcome);
    assert.equal(outcome.reason, "redirect_rejected");
  } finally {
    await s.close();
  }
});

test("fetch: Range forwarded; 206 preserved (identity artifact)", async () => {
  const s = await startServer((_u, req, res) => {
    assert.equal(req.headers["range"], "bytes=0-4");
    res.writeHead(206, { "content-range": "bytes 0-4/12", "content-length": "5", "accept-ranges": "bytes" });
    res.end(MOCK.subarray(0, 5));
  });
  try {
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord({ bytes: MOCK.length }), method: "GET", range: "bytes=0-4" });
    assertStream(outcome);
    assert.equal(outcome.status, 206);
    assert.equal(outcome.headers.get("content-range"), "bytes 0-4/12");
    const body = await drain(outcome.body!);
    assert.equal(body.length, 5);
  } finally {
    await s.close();
  }
});

test("fetch: pre-aborted client signal propagated", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, {});
    res.end(MOCK);
  });
  try {
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord(), method: "GET", signal: (() => { const ac = new AbortController(); ac.abort(); return ac.signal; })() });
    assertError(outcome);
    assert.equal(outcome.reason, "client_abort");
  } finally {
    await s.close();
  }
});

test("fetch: mid-stream client abort cancels upstream (client_abort)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, {}); // identity, no content-encoding
    res.write(Buffer.from("first"));
    const t = setInterval(() => res.write(Buffer.from("x")), 30);
    res.on("close", () => clearInterval(t));
  });
  try {
    const diags: Diagnostics[] = [];
    const ac = new AbortController();
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord({ bytes: 100 }), method: "GET", signal: ac.signal, onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    const reader = outcome.body!.getReader();
    const first = await reader.read();
    assert.ok(first.value && first.value.byteLength > 0);
    ac.abort();
    await assert.rejects(async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    });
    assert.equal(diags[0]?.reason, "client_abort");
  } finally {
    await s.close();
  }
});

test("fetch: body stalls after first chunk → body_timeout", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, {}); // identity
    res.write(Buffer.from("first"));
    // never end → stalls
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord({ bytes: 100 }), method: "GET", timeouts: { headersMs: 5000, bodyMs: 80 }, onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    const reader = outcome.body!.getReader();
    const first = await reader.read();
    assert.ok(first.value && first.value.byteLength > 0);
    await assert.rejects(async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    });
    assert.equal(diags[0]?.reason, "body_timeout");
  } finally {
    await s.close();
  }
});

test("fetch: header-phase timeout (never responds)", async () => {
  const s = await startServer(() => {
    /* never respond */
  });
  try {
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord(), method: "GET", timeouts: { headersMs: 80, bodyMs: 5000 } });
    assertError(outcome);
    assert.equal(outcome.reason, "headers_timeout");
    assert.equal(outcome.status, 504);
  } finally {
    await s.close();
  }
});

test("fetch: successful completion cleans up (no later timeout, single emission)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-length": String(MOCK.length) });
    res.end(MOCK);
  });
  try {
    const diags: Diagnostics[] = [];
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord({ bytes: MOCK.length }), method: "GET", timeouts: { headersMs: 5000, bodyMs: 60 }, onDiagnostics: (d) => diags.push(d) });
    assertStream(outcome);
    const body = await drain(outcome.body!);
    assert.ok(body.equals(MOCK));
    await sleep(150);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "complete");
  } finally {
    await s.close();
  }
});

test("fetch: HEAD returns headers and no body (identity)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-length": String(MOCK.length) });
    res.end();
  });
  try {
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord({ bytes: MOCK.length }), method: "HEAD" });
    assertStream(outcome);
    assert.equal(outcome.body, null);
    assert.equal(outcome.headers.get("content-type"), "application/javascript");
  } finally {
    await s.close();
  }
});

// ── Versioned upstream artifact path (B6C /releases/<version>/… hosting) ──────
// The dedicated B6C artifact deployment hosts each immutable release under
// /releases/<releaseVersion>/…, NOT at /Build/…. The harness must derive the
// upstream path from the compile-time-pinned EXPECTED_RELEASE_ID + the validated
// fixture record.path, and the origin must stay a bare HTTPS origin.

const EXPECTED_WASM_UPSTREAM_PATH =
  "releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.wasm.gz";

test("upstream path: wasm derives exactly the pinned versioned release path", () => {
  const wasm = loadProofManifest().records.find((r) => r.label === "wasm")!;
  assert.equal(buildUpstreamArtifactPath(wasm), EXPECTED_WASM_UPSTREAM_PATH);
});

test("upstream path: data/framework/loader use the same pinned release prefix", () => {
  const prefix = `releases/${EXPECTED_RELEASE_ID}/`;
  for (const r of loadProofManifest().records) {
    const p = buildUpstreamArtifactPath(r);
    assert.equal(p, `releases/${EXPECTED_RELEASE_ID}/${r.path}`);
    assert.ok(p.startsWith(prefix), `${r.label} must start with ${prefix}`);
    assert.ok(!p.startsWith("Build/"), `${r.label} must not be a bare /Build path`);
  }
  const byLabel = (l: string) => loadProofManifest().records.find((r) => r.label === l)!;
  assert.equal(
    buildUpstreamArtifactPath(byLabel("data")),
    "releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.data.gz",
  );
  assert.equal(
    buildUpstreamArtifactPath(byLabel("framework")),
    "releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.framework.js.gz",
  );
  assert.equal(
    buildUpstreamArtifactPath(byLabel("loader")),
    "releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.loader.js",
  );
});

test("upstream path: prefix is pinned and record-only (no query/user input can alter it)", () => {
  const wasm = loadProofManifest().records.find((r) => r.label === "wasm")!;
  // The function takes ONLY the record; an identical record yields an identical
  // path, always under the compile-time EXPECTED_RELEASE_ID prefix.
  assert.equal(buildUpstreamArtifactPath(wasm), buildUpstreamArtifactPath({ ...wasm }));
  assert.ok(buildUpstreamArtifactPath(wasm).startsWith(`releases/${EXPECTED_RELEASE_ID}/`));
  assert.equal(EXPECTED_RELEASE_ID, "b6b-local-fb840878-d");
});

test("raw: upstream request hits the exact versioned path, never /Build/...", async () => {
  let seenUrl: string | null = null;
  const s = await startServer((reqUrl, _req, res) => {
    seenUrl = reqUrl;
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(MOCK.length) });
    res.end(MOCK);
  });
  try {
    const record = gzipRecord({ path: "Build/b6b-local-fb840878-d.wasm.gz", bytes: MOCK.length });
    const outcome = await rawTransport({ origin: s.origin, record, method: "GET" });
    assertStream(outcome);
    await drain(outcome.body!);
    assert.equal(seenUrl, `/${EXPECTED_WASM_UPSTREAM_PATH}`);
    assert.equal((seenUrl as string).startsWith("/Build/"), false);
  } finally {
    await s.close();
  }
});

test("fetch: upstream request hits the exact versioned path, never /Build/...", async () => {
  let seenUrl: string | null = null;
  const s = await startServer((reqUrl, _req, res) => {
    seenUrl = reqUrl;
    res.writeHead(200, { "content-length": String(MOCK.length) });
    res.end(MOCK);
  });
  try {
    const record = identityRecord({ path: "Build/b6b-local-fb840878-d.loader.js", bytes: MOCK.length });
    const outcome = await fetchTransport({ origin: s.origin, record, method: "GET" });
    assertStream(outcome);
    await drain(outcome.body!);
    assert.equal(seenUrl, "/releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.loader.js");
    assert.equal((seenUrl as string).startsWith("/Build/"), false);
  } finally {
    await s.close();
  }
});

test("origin validation: an origin containing /releases/<version> remains rejected", () => {
  // The release prefix must be derived internally, never smuggled into the origin.
  assert.equal(
    validateArtifactOrigin("https://host.example/releases/b6b-local-fb840878-d"),
    null,
  );
  assert.equal(
    validateArtifactOrigin("http://127.0.0.1:5000/releases/b6b-local-fb840878-d", { allowHttp: true }),
    null,
  );
  // A bare origin remains accepted (control), and stays bare (no path).
  assert.equal(validateArtifactOrigin("https://host.example"), "https://host.example");
});
