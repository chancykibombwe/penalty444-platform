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

import { fetchTransport, rawTransport, type Diagnostics, type ProxyOutcome } from "./streamProxy";
import type { ArtifactRecord } from "./manifest";

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

// ── RAW transport ───────────────────────────────────────────────────────────
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
    });
    res.end(MOCK);
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord({ bytes: MOCK.length }), method: "GET" });
    assertStream(outcome);
    for (const h of ["server", "set-cookie", "location", "x-powered-by", "via"]) {
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

test("raw: delayed multi-chunk stays streamed; first chunk before completion", async () => {
  let secondChunkSent = false;
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.write(Buffer.from("first"));
    setTimeout(() => {
      secondChunkSent = true;
      res.write(Buffer.from("second"));
      res.end();
    }, 120);
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET" });
    assertStream(outcome);
    const reader = outcome.body!.getReader();
    const first = await reader.read();
    assert.equal(secondChunkSent, false, "first chunk must arrive before upstream completes");
    assert.ok(first.value && first.value.byteLength > 0);
    // drain the rest
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

test("raw: headers timeout handled", async () => {
  const s = await startServer(() => {
    /* never respond */
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET", timeoutMs: 80 });
    assertError(outcome);
    assert.equal(outcome.reason, "headers_timeout");
    assert.equal(outcome.status, 504);
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
    assert.equal(outcome.headers.get("accept-ranges"), "bytes");
    const body = await drain(outcome.body!);
    assert.equal(body.length, 5);
  } finally {
    await s.close();
  }
});

test("raw: 416 preserved", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(416, { "content-range": "bytes */12" });
    res.end();
  });
  try {
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET", range: "bytes=999-1000" });
    assertStream(outcome);
    assert.equal(outcome.status, 416);
  } finally {
    await s.close();
  }
});

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
    // keep writing slowly; never end
    const t = setInterval(() => {
      res.write(Buffer.from("x"));
    }, 30);
    res.on("close", () => clearInterval(t));
  });
  try {
    const diags: Diagnostics[] = [];
    const ac = new AbortController();
    const outcome = await rawTransport({ origin: s.origin, record: gzipRecord(), method: "GET", signal: ac.signal, onDiagnostics: (d) => diags.push(d) });
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
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord({ bytes: MOCK.length }), method: "GET" });
    assertStream(outcome);
    assert.equal(outcome.status, 200);
    assert.equal(outcome.headers.get("content-type"), "application/javascript");
    assert.equal(outcome.headers.get("content-encoding"), "identity");
    const body = await drain(outcome.body!);
    assert.ok(body.equals(MOCK));
  } finally {
    await s.close();
  }
});

test("fetch: gzip artifact fails closed on detectable decompression", async () => {
  // Undici transparently decompresses gzip and drops content-encoding, so a
  // gzip artifact whose response no longer advertises gzip must fail closed.
  const s = await startServer((_u, _req, res) => {
    // Simulate the decompressed-and-header-dropped condition directly.
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
    await outcome.body?.cancel();
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
    const ac = new AbortController();
    ac.abort();
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord(), method: "GET", signal: ac.signal });
    assertError(outcome);
    assert.equal(outcome.reason, "client_abort");
  } finally {
    await s.close();
  }
});

test("fetch: timeout handled", async () => {
  const s = await startServer(() => {
    /* never respond */
  });
  try {
    const outcome = await fetchTransport({ origin: s.origin, record: identityRecord(), method: "GET", timeoutMs: 80 });
    assertError(outcome);
    assert.equal(outcome.reason, "body_timeout");
    assert.equal(outcome.status, 504);
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
