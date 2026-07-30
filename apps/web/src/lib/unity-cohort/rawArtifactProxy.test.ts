/**
 * B6D3B PR-1 — raw artifact streaming tests.
 * Node `node:test` via `tsx`. In-process loopback HTTP mock servers ONLY —
 * no internet, no Vercel, no real artifact body, no real origin.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

import {
  build416Headers,
  buildArtifactHeaders,
  streamArtifact,
  type ArtifactDiagnostics,
  type ArtifactProxyOutcome,
  type RawClientRequestLike,
} from "./rawArtifactProxy";
import type { ArtifactRecord } from "./artifactManifest";

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Deterministic mock bodies. GZIP_BODY starts with the real gzip magic 1F 8B.
const GZIP_BODY = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
const IDENTITY_BODY = Buffer.from("console.log('loader');");

function gzipRecord(over: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    label: "wasm",
    path: "Build/b6b-local-fb840878-d.wasm.gz",
    bytes: GZIP_BODY.length,
    sha256: "c".repeat(64),
    contentEncoding: "gzip",
    contentType: "application/wasm",
    ...over,
  };
}

function loaderRecord(over: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    label: "loader",
    path: "Build/b6b-local-fb840878-d.loader.js",
    bytes: IDENTITY_BODY.length,
    sha256: "d".repeat(64),
    contentEncoding: "identity",
    contentType: "application/javascript",
    ...over,
  };
}

function assertStream(o: ArtifactProxyOutcome): asserts o is Extract<ArtifactProxyOutcome, { kind: "stream" }> {
  assert.equal(o.kind, "stream");
}
function assertError(o: ArtifactProxyOutcome): asserts o is Extract<ArtifactProxyOutcome, { kind: "error" }> {
  assert.equal(o.kind, "error");
}

// ── happy path: byte preservation ─────────────────────────────────────────────

test("gzip artifact: compressed bytes preserved verbatim with correct headers", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, {
      "content-type": "x/ignored-upstream",
      "content-encoding": "gzip",
      "content-length": String(GZIP_BODY.length),
      "accept-ranges": "bytes",
    });
    res.end(GZIP_BODY);
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const record = gzipRecord();
    const outcome = await streamArtifact({
      origin: s.origin,
      record,
      method: "GET",
      onDiagnostics: (d) => diags.push(d),
    });
    assertStream(outcome);
    assert.equal(outcome.status, 200);
    assert.equal(outcome.headers.get("content-type"), "application/wasm");
    assert.equal(outcome.headers.get("content-encoding"), "gzip");
    assert.equal(outcome.headers.get("content-length"), String(GZIP_BODY.length));
    assert.equal(outcome.headers.get("accept-ranges"), "bytes");
    assert.equal(outcome.headers.get("etag"), `"sha256-${record.sha256}"`);
    assert.equal(outcome.headers.get("content-disposition"), "inline");
    const body = await drain(outcome.body!);
    assert.ok(body.equals(GZIP_BODY), "bytes must be identical");
    assert.equal(createHash("sha256").update(body).digest("hex"), createHash("sha256").update(GZIP_BODY).digest("hex"));
    assert.equal(body[0], 0x1f);
    assert.equal(body[1], 0x8b);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "complete");
    assert.equal(diags[0].totalBytes, GZIP_BODY.length);
    assert.equal(diags[0].transport, "raw");
  } finally {
    await s.close();
  }
});

test("identity loader: bytes preserved with identity encoding", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-length": String(IDENTITY_BODY.length) });
    res.end(IDENTITY_BODY);
  });
  try {
    const outcome = await streamArtifact({ origin: s.origin, record: loaderRecord(), method: "GET" });
    assertStream(outcome);
    assert.equal(outcome.headers.get("content-type"), "application/javascript");
    assert.equal(outcome.headers.get("content-encoding"), "identity");
    const body = await drain(outcome.body!);
    assert.ok(body.equals(IDENTITY_BODY));
  } finally {
    await s.close();
  }
});

test("requests the internally pinned versioned upstream path (never /Build/...)", async () => {
  let seenUrl: string | null = null;
  const s = await startServer((reqUrl, _req, res) => {
    seenUrl = reqUrl;
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(GZIP_BODY.length) });
    res.end(GZIP_BODY);
  });
  try {
    const outcome = await streamArtifact({ origin: s.origin, record: gzipRecord(), method: "GET" });
    assertStream(outcome);
    await drain(outcome.body!);
    assert.equal(seenUrl, "/releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.wasm.gz");
    assert.equal((seenUrl as string).startsWith("/Build/"), false);
  } finally {
    await s.close();
  }
});

test("HEAD returns headers and no body", async () => {
  const s = await startServer((_u, req, res) => {
    assert.equal(req.method, "HEAD");
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(GZIP_BODY.length) });
    res.end();
  });
  try {
    const outcome = await streamArtifact({ origin: s.origin, record: gzipRecord(), method: "HEAD" });
    assertStream(outcome);
    assert.equal(outcome.body, null);
    assert.equal(outcome.headers.get("content-type"), "application/wasm");
    assert.equal(outcome.headers.get("content-length"), String(GZIP_BODY.length));
  } finally {
    await s.close();
  }
});

// ── cache / leakage discipline ────────────────────────────────────────────────

test("protected cache policy present; public/CDN caching absent; upstream headers stripped", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, {
      "content-encoding": "gzip",
      "content-length": String(GZIP_BODY.length),
      server: "nginx/1.2",
      via: "1.1 vegur",
      "x-powered-by": "Express",
      "set-cookie": "sid=abc",
      location: "https://evil.example.com",
      "cache-control": "public, max-age=31536000, immutable",
      "cdn-cache-control": "public, max-age=31536000",
      "x-vercel-enable-rewrite-caching": "1",
      "x-vercel-id": "iad1::abc",
      etag: '"upstream-etag"',
      "x-upstream-secret": "leak",
    });
    res.end(GZIP_BODY);
  });
  try {
    const record = gzipRecord();
    const outcome = await streamArtifact({ origin: s.origin, record, method: "GET" });
    assertStream(outcome);
    assert.equal(outcome.headers.get("cache-control"), "private, no-store");
    assert.equal(outcome.headers.get("vary"), "Cookie");
    assert.equal(outcome.headers.get("x-content-type-options"), "nosniff");
    for (const h of [
      "server",
      "via",
      "x-powered-by",
      "set-cookie",
      "location",
      "cdn-cache-control",
      "x-vercel-enable-rewrite-caching",
      "x-vercel-id",
      "x-upstream-secret",
    ]) {
      assert.equal(outcome.headers.get(h), null, `${h} must not be forwarded`);
    }
    // ETag is ours (pinned SHA), never the upstream value.
    assert.equal(outcome.headers.get("etag"), `"sha256-${record.sha256}"`);
    const all = JSON.stringify([...outcome.headers.entries()]);
    assert.equal(/public|s-maxage|immutable/i.test(all), false);
    assert.equal(all.includes("127.0.0.1"), false, "origin host must never leak");
    await outcome.body?.cancel();
  } finally {
    await s.close();
  }
});

test("absent Accept-Ranges stays absent (never fabricated)", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(GZIP_BODY.length) });
    res.end(GZIP_BODY);
  });
  try {
    const outcome = await streamArtifact({ origin: s.origin, record: gzipRecord(), method: "GET" });
    assertStream(outcome);
    assert.equal(outcome.headers.get("accept-ranges"), null);
    await outcome.body?.cancel();
  } finally {
    await s.close();
  }
});

// ── Range / 206 / 416 ─────────────────────────────────────────────────────────

test("Range bytes=0-0 → 206 with valid Content-Range and the first gzip byte 1F", async () => {
  const s = await startServer((_u, req, res) => {
    assert.equal(req.headers["range"], "bytes=0-0");
    res.writeHead(206, {
      "content-encoding": "gzip",
      "content-range": `bytes 0-0/${GZIP_BODY.length}`,
      "content-length": "1",
      "accept-ranges": "bytes",
    });
    res.end(GZIP_BODY.subarray(0, 1));
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      range: "bytes=0-0",
      onDiagnostics: (d) => diags.push(d),
    });
    assertStream(outcome);
    assert.equal(outcome.status, 206);
    assert.equal(outcome.headers.get("content-range"), `bytes 0-0/${GZIP_BODY.length}`);
    assert.equal(outcome.headers.get("content-length"), "1");
    assert.equal(outcome.headers.get("content-encoding"), "gzip");
    const body = await drain(outcome.body!);
    assert.equal(body.length, 1);
    assert.equal(body[0], 0x1f, "must be the gzip magic first byte");
    assert.equal(diags[0].rangeUsed, true);
    assert.equal(diags[0].reason, "complete");
  } finally {
    await s.close();
  }
});

test("invalid or mismatched Content-Range fails closed", async () => {
  for (const cr of ["garbage", "bytes 5-1/12", "bytes 0-0/999", "items 0-0/12"]) {
    const s = await startServer((_u, _req, res) => {
      res.writeHead(206, { "content-encoding": "gzip", "content-range": cr, "content-length": "1" });
      res.end(GZIP_BODY.subarray(0, 1));
    });
    try {
      const outcome = await streamArtifact({
        origin: s.origin,
        record: gzipRecord(),
        method: "GET",
        range: "bytes=0-0",
      });
      assertError(outcome);
      assert.ok(
        outcome.reason === "header_mismatch" || outcome.reason === "byte_mismatch",
        `unexpected reason for ${cr}: ${outcome.reason}`,
      );
    } finally {
      await s.close();
    }
  }
});

test("416 preserves only safe range metadata and never forwards the upstream body", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(416, { "content-range": `bytes */${GZIP_BODY.length}`, "content-encoding": "gzip" });
    res.end("UPSTREAM-ERROR-PAGE-MUST-NOT-LEAK");
  });
  try {
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      range: "bytes=999-1000",
    });
    assertStream(outcome);
    assert.equal(outcome.status, 416);
    assert.equal(outcome.body, null);
    assert.equal(outcome.headers.get("content-range"), `bytes */${GZIP_BODY.length}`);
    assert.equal(outcome.headers.get("content-encoding"), null);
    assert.equal(outcome.headers.get("content-length"), null);
    assert.equal(outcome.headers.get("content-type"), null);
    assert.equal(outcome.headers.get("cache-control"), "private, no-store");
  } finally {
    await s.close();
  }
});

test("a 206 without a Range request is an upstream error", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(206, { "content-encoding": "gzip", "content-range": "bytes 0-0/12" });
    res.end(GZIP_BODY.subarray(0, 1));
  });
  try {
    const outcome = await streamArtifact({ origin: s.origin, record: gzipRecord(), method: "GET" });
    assertError(outcome);
    assert.equal(outcome.reason, "upstream_error");
  } finally {
    await s.close();
  }
});

// ── fail-closed contradictions ────────────────────────────────────────────────

test("content-encoding mismatch fails closed before streaming", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" }); // gzip record, no gzip
    res.end(GZIP_BODY);
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      onDiagnostics: (d) => diags.push(d),
    });
    assertError(outcome);
    assert.equal(outcome.reason, "header_mismatch");
    assert.equal(diags[0].reason, "header_mismatch");
    assert.equal(diags[0].totalBytes, 0, "nothing streamed");
  } finally {
    await s.close();
  }
});

test("declared Content-Length contradiction fails closed before streaming", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": "999" });
    res.end(GZIP_BODY);
  });
  try {
    const outcome = await streamArtifact({ origin: s.origin, record: gzipRecord(), method: "GET" });
    assertError(outcome);
    assert.equal(outcome.reason, "byte_mismatch");
  } finally {
    await s.close();
  }
});

test("short body (streamed byte-count contradiction) aborts the stream", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" }); // no declared length
    res.end(GZIP_BODY.subarray(0, 5)); // fewer bytes than pinned
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      onDiagnostics: (d) => diags.push(d),
    });
    assertStream(outcome);
    await assert.rejects(async () => {
      await drain(outcome.body!);
    });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "byte_mismatch");
  } finally {
    await s.close();
  }
});

test("over-long body aborts on the byte ceiling", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end(Buffer.concat([GZIP_BODY, Buffer.alloc(64, 7)])); // more than pinned
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      onDiagnostics: (d) => diags.push(d),
    });
    assertStream(outcome);
    await assert.rejects(async () => {
      await drain(outcome.body!);
    });
    assert.equal(diags[0].reason, "byte_mismatch");
  } finally {
    await s.close();
  }
});

test("upstream redirect is rejected and never followed", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(302, { location: "https://evil.example.com/x" });
    res.end();
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      onDiagnostics: (d) => diags.push(d),
    });
    assertError(outcome);
    assert.equal(outcome.reason, "redirect_rejected");
    assert.equal(diags[0].reason, "redirect_rejected");
  } finally {
    await s.close();
  }
});

test("non-200/206/416 upstream status is a sanitized upstream error", async () => {
  for (const status of [400, 401, 403, 404, 500, 503]) {
    const s = await startServer((_u, _req, res) => {
      res.writeHead(status, { "content-type": "text/html" });
      res.end("<html>upstream error page</html>");
    });
    try {
      const outcome = await streamArtifact({ origin: s.origin, record: gzipRecord(), method: "GET" });
      assertError(outcome);
      assert.equal(outcome.reason, "upstream_error");
      assert.equal(outcome.status, 502);
    } finally {
      await s.close();
    }
  }
});

// ── timeouts ──────────────────────────────────────────────────────────────────

test("connect timeout (deterministic, injected request factory)", async () => {
  const neverConnect: RawClientRequestLike = {
    on() {
      return this;
    },
    destroy() {},
    end() {},
  };
  const diags: ArtifactDiagnostics[] = [];
  const outcome = await streamArtifact(
    {
      origin: "http://127.0.0.1:1",
      record: gzipRecord(),
      method: "GET",
      timeouts: { connectMs: 60, headersMs: 5000, bodyMs: 5000 },
      onDiagnostics: (d) => diags.push(d),
    },
    { request: () => neverConnect },
  );
  assertError(outcome);
  assert.equal(outcome.reason, "connect_timeout");
  assert.equal(outcome.status, 504);
  assert.equal(diags[0].reason, "connect_timeout");
});

test("response-header timeout (connects, never responds)", async () => {
  const s = await startServer(() => {
    /* accept, never send headers */
  });
  try {
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      timeouts: { connectMs: 5000, headersMs: 80, bodyMs: 5000 },
    });
    assertError(outcome);
    assert.equal(outcome.reason, "headers_timeout");
    assert.equal(outcome.status, 504);
  } finally {
    await s.close();
  }
});

test("body inactivity timeout after the first chunk", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.write(GZIP_BODY.subarray(0, 2));
    // never write more, never end → stall
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      timeouts: { connectMs: 5000, headersMs: 5000, bodyMs: 80 },
      onDiagnostics: (d) => diags.push(d),
    });
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

test("successful completion cleans up: no late timer, single diagnostic emission", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(GZIP_BODY.length) });
    res.end(GZIP_BODY);
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      timeouts: { connectMs: 5000, headersMs: 5000, bodyMs: 60 },
      onDiagnostics: (d) => diags.push(d),
    });
    assertStream(outcome);
    const body = await drain(outcome.body!);
    assert.ok(body.equals(GZIP_BODY));
    await sleep(150); // longer than bodyMs — no late body_timeout may fire
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "complete");
  } finally {
    await s.close();
  }
});

// ── abort ─────────────────────────────────────────────────────────────────────

test("pre-aborted client signal denies as client_abort", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end(GZIP_BODY);
  });
  try {
    const ac = new AbortController();
    ac.abort();
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord(),
      method: "GET",
      signal: ac.signal,
    });
    assertError(outcome);
    assert.equal(outcome.reason, "client_abort");
  } finally {
    await s.close();
  }
});

test("mid-stream client abort destroys upstream and reports client_abort once", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.write(GZIP_BODY.subarray(0, 2));
    const t = setInterval(() => res.write(Buffer.from([0x00])), 30);
    res.on("close", () => clearInterval(t));
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const ac = new AbortController();
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord({ bytes: 1_000_000 }),
      method: "GET",
      signal: ac.signal,
      onDiagnostics: (d) => diags.push(d),
    });
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
    assert.equal(diags.length, 1, "diagnostics emit at most once");
    assert.equal(diags[0].reason, "client_abort");
  } finally {
    await s.close();
  }
});

test("consumer cancel reports client_abort exactly once", async () => {
  const s = await startServer((_u, _req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.write(GZIP_BODY.subarray(0, 2));
    const t = setInterval(() => res.write(Buffer.from([0x00])), 30);
    res.on("close", () => clearInterval(t));
  });
  try {
    const diags: ArtifactDiagnostics[] = [];
    const outcome = await streamArtifact({
      origin: s.origin,
      record: gzipRecord({ bytes: 1_000_000 }),
      method: "GET",
      onDiagnostics: (d) => diags.push(d),
    });
    assertStream(outcome);
    const reader = outcome.body!.getReader();
    await reader.read();
    await reader.cancel("done");
    await sleep(20);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].reason, "client_abort");
  } finally {
    await s.close();
  }
});

// ── header-builder unit checks ────────────────────────────────────────────────

test("buildArtifactHeaders: 200 declares the pinned length and pinned ETag", () => {
  const record = gzipRecord();
  const built = buildArtifactHeaders({
    status: 200,
    record,
    upstreamContentEncoding: "gzip",
    upstreamContentLength: String(record.bytes),
    upstreamContentRange: undefined,
    upstreamAcceptRanges: "bytes",
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.expectedBytes, record.bytes);
    assert.equal(built.headers.get("content-length"), String(record.bytes));
    assert.equal(built.headers.get("etag"), `"sha256-${record.sha256}"`);
    assert.equal(built.headers.get("cache-control"), "private, no-store");
    assert.equal(built.headers.get("vary"), "Cookie");
  }
});

test("buildArtifactHeaders: identity record rejects a gzip upstream encoding", () => {
  const built = buildArtifactHeaders({
    status: 200,
    record: loaderRecord(),
    upstreamContentEncoding: "gzip",
    upstreamContentLength: undefined,
    upstreamContentRange: undefined,
    upstreamAcceptRanges: undefined,
  });
  assert.equal(built.ok, false);
  if (!built.ok) assert.equal(built.reason, "header_mismatch");
});

test("build416Headers omits artifact type/encoding/length entirely", () => {
  const h = build416Headers("bytes */12", "bytes");
  assert.equal(h.get("content-range"), "bytes */12");
  assert.equal(h.get("accept-ranges"), "bytes");
  assert.equal(h.get("content-type"), null);
  assert.equal(h.get("content-encoding"), null);
  assert.equal(h.get("content-length"), null);
  assert.equal(h.get("etag"), null);
  assert.equal(h.get("cache-control"), "private, no-store");
  // A malformed upstream Content-Range is not echoed.
  assert.equal(build416Headers("garbage", undefined).get("content-range"), null);
});
