/**
 * B6D3B PR-1 — protected artifact route tests.
 * Node `node:test` via `tsx`. Loopback mock upstream ONLY; no internet, no Vercel,
 * no real artifact body, no real origin.
 *
 * Proves: production denial precedes upstream work; capability gating; exact
 * manifest path resolution with traversal denial; that the artifact route performs
 * NO per-file Supabase lookup (bounded-TTL revocation model); and the protected
 * cache/Vary policy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  createArtifactHandler,
  type ArtifactRouteContext,
} from "../../../../lib/unity-cohort/handlers";
import { COHORT_COOKIE_NAME, signCapability } from "../../../../lib/unity-cohort/capability";
import { GET as liveGET, HEAD as liveHEAD } from "./route";
import * as routeModule from "./route";
import type { ArtifactProxyOutcome, ArtifactProxyRequest } from "../../../../lib/unity-cohort/rawArtifactProxy";
import { streamArtifact } from "../../../../lib/unity-cohort/rawArtifactProxy";

const SECRET = "s".repeat(32);
const USER_ID = "11111111-2222-3333-4444-555555555555";
const NOW = 1_800_000_000;
const VER = 5;
const ORIGIN = "https://proj-deadbeef-team.vercel.app";

const WASM_SEGMENTS = ["Build", "b6b-local-fb840878-d.wasm.gz"];
const GZIP_BODY = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x09, 0x08, 0x07, 0x06]);

function env(over: Record<string, string | undefined> = {}) {
  return () => ({
    VERCEL_ENV: "preview",
    UNITY_COHORT_EMAILS: "member@example.com",
    UNITY_COHORT_SIGNING_SECRET: SECRET,
    UNITY_COHORT_TOKEN_VERSION: String(VER),
    UNITY_COHORT_ARTIFACT_ORIGIN: ORIGIN,
    ...over,
  });
}

function validToken(over: { ttlSeconds?: number; ver?: number; secret?: string } = {}): string {
  const signed = signCapability({
    sub: USER_ID,
    nowSeconds: NOW,
    ttlSeconds: over.ttlSeconds ?? 600,
    ver: over.ver ?? VER,
    secret: over.secret ?? SECRET,
  });
  assert.ok(signed);
  return signed.token;
}

function ctx(path: string[]): ArtifactRouteContext {
  return { params: Promise.resolve({ path }) };
}

function req(cookie?: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/unity-arena/artifact/Build/x", {
    headers: cookie === undefined ? headers : { cookie, ...headers },
  });
}

/** Stub transport that records the request and returns a fixed stream. */
function stubTransport(captured: ArtifactProxyRequest[] = []) {
  return {
    captured,
    impl: async (r: ArtifactProxyRequest): Promise<ArtifactProxyOutcome> => {
      captured.push(r);
      const headers = new Headers({
        "Content-Type": r.record.contentType,
        "Content-Encoding": r.record.contentEncoding,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        ETag: `"sha256-${r.record.sha256}"`,
      });
      return {
        kind: "stream",
        status: 200,
        headers,
        body:
          r.method === "HEAD"
            ? null
            : new ReadableStream<Uint8Array>({
                start(c) {
                  c.enqueue(new Uint8Array(GZIP_BODY));
                  c.close();
                },
              }),
      };
    },
  };
}

function handler(over: Partial<Parameters<typeof createArtifactHandler>[0]> = {}) {
  return createArtifactHandler({
    readEnv: env(),
    nowSeconds: () => NOW + 1,
    streamArtifactImpl: stubTransport().impl,
    onDiagnostics: () => {},
    ...over,
  });
}

async function assertOpaque404(res: Response): Promise<void> {
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "Not Found");
  assert.equal(res.headers.get("cache-control"), "no-store");
}

test("route exports nodejs runtime, force-dynamic, GET and HEAD", () => {
  assert.equal(routeModule.runtime, "nodejs");
  assert.equal(routeModule.dynamic, "force-dynamic");
  assert.equal(typeof liveGET, "function");
  assert.equal(typeof liveHEAD, "function");
});

// ── production denial ordering ─────────────────────────────────────────────────

test("production returns opaque 404 before any upstream request", async () => {
  const t = stubTransport();
  const h = handler({ readEnv: env({ VERCEL_ENV: "production" }), streamArtifactImpl: t.impl });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS)));
  await assertOpaque404(await h.HEAD(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS)));
  assert.equal(t.captured.length, 0, "production must never contact upstream");
});

// ── capability gates ──────────────────────────────────────────────────────────

test("missing / invalid / expired / wrong-version cookie → opaque 404, no upstream", async () => {
  const t = stubTransport();
  const h = handler({ streamArtifactImpl: t.impl });
  await assertOpaque404(await h.GET(req(undefined), ctx(WASM_SEGMENTS)));
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=garbage`), ctx(WASM_SEGMENTS)));
  await assertOpaque404(
    await handler({ streamArtifactImpl: t.impl, nowSeconds: () => NOW + 601 }).GET(
      req(`${COHORT_COOKIE_NAME}=${validToken({ ttlSeconds: 600 })}`),
      ctx(WASM_SEGMENTS),
    ),
  );
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken({ ver: VER + 1 })}`), ctx(WASM_SEGMENTS)));
  await assertOpaque404(
    await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken({ secret: "z".repeat(32) })}`), ctx(WASM_SEGMENTS)),
  );
  assert.equal(t.captured.length, 0);
});

test("artifact route performs NO Supabase lookup (bounded-TTL revocation model)", async () => {
  // No admin client is injected at all; an authorized request still succeeds,
  // proving the artifact path never depends on a per-file identity lookup.
  const t = stubTransport();
  const h = createArtifactHandler({
    readEnv: env(),
    nowSeconds: () => NOW + 1,
    streamArtifactImpl: t.impl,
    onDiagnostics: () => {},
  });
  const res = await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS));
  assert.equal(res.status, 200);
  assert.equal(t.captured.length, 1);
});

test("expiry alone denies every artifact request (TTL bound)", async () => {
  const t = stubTransport();
  const h = handler({ streamArtifactImpl: t.impl, nowSeconds: () => NOW + 600 });
  await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS)));
  assert.equal(t.captured.length, 0);
});

// ── path security ─────────────────────────────────────────────────────────────

test("each allowlisted artifact is served with the pinned record", async () => {
  const paths = [
    ["Build", "b6b-local-fb840878-d.loader.js"],
    ["Build", "b6b-local-fb840878-d.framework.js.gz"],
    ["Build", "b6b-local-fb840878-d.data.gz"],
    ["Build", "b6b-local-fb840878-d.wasm.gz"],
  ];
  for (const p of paths) {
    const t = stubTransport();
    const res = await handler({ streamArtifactImpl: t.impl }).GET(
      req(`${COHORT_COOKIE_NAME}=${validToken()}`),
      ctx(p),
    );
    assert.equal(res.status, 200, `failed for ${p.join("/")}`);
    assert.equal(t.captured[0].record.path, p.join("/"));
    assert.equal(t.captured[0].origin, ORIGIN);
  }
});

test("traversal / encoded / absolute / unknown / case-mismatch paths → opaque 404", async () => {
  const t = stubTransport();
  const h = handler({ streamArtifactImpl: t.impl });
  const attacks: string[][] = [
    ["..", "secret"],
    ["Build", "..", "..", "etc", "passwd"],
    ["%2e%2e", "secret"],
    ["%252e%252e", "secret"],
    ["Build\\b6b-local-fb840878-d.wasm.gz"],
    ["Build%5Cx"],
    ["/etc/passwd"],
    ["https://evil.example.com/x"],
    ["//evil.example.com/x"],
    ["C:", "Windows"],
    ["build", "b6b-local-fb840878-d.wasm.gz"],
    ["Build", "B6B-LOCAL-FB840878-D.WASM.GZ"],
    ["index.html"],
    ["TemplateData", "style.css"],
    ["Build", "b6b-local-fb840878-d.wasm.gz", "extra"],
    [],
  ];
  for (const a of attacks) {
    await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(a)));
  }
  assert.equal(t.captured.length, 0, "no attack may reach upstream");
});

// ── origin configuration ──────────────────────────────────────────────────────

test("missing or invalid artifact origin fails closed with opaque 404", async () => {
  for (const bad of [undefined, "", "http://proj-x-team.vercel.app", "https://alias.vercel.app", `${ORIGIN}/releases/x`]) {
    const t = stubTransport();
    const h = handler({ readEnv: env({ UNITY_COHORT_ARTIFACT_ORIGIN: bad }), streamArtifactImpl: t.impl });
    await assertOpaque404(await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS)));
    assert.equal(t.captured.length, 0);
  }
});

// ── authorized delivery ───────────────────────────────────────────────────────

test("authorized GET streams with the protected cache policy and no public caching", async () => {
  const res = await handler().GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/wasm");
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("vary"), "Cookie");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok((res.headers.get("etag") ?? "").startsWith('"sha256-'));
  const all = JSON.stringify([...res.headers.entries()]);
  assert.equal(/public|s-maxage|immutable|cdn-cache-control|x-vercel-enable-rewrite-caching/i.test(all), false);
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.equals(GZIP_BODY));
});

test("authorized HEAD returns headers and no body", async () => {
  const res = await handler().HEAD(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS));
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(await res.arrayBuffer()).length, 0);
  assert.equal(res.headers.get("content-type"), "application/wasm");
});

test("Range header is forwarded to the transport", async () => {
  const t = stubTransport();
  await handler({ streamArtifactImpl: t.impl }).GET(
    req(`${COHORT_COOKIE_NAME}=${validToken()}`, { range: "bytes=0-0" }),
    ctx(WASM_SEGMENTS),
  );
  assert.equal(t.captured[0].range, "bytes=0-0");
});

test("neither the upstream origin nor the cookie appears in a success response", async () => {
  const res = await handler().GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS));
  const all = JSON.stringify([...res.headers.entries()]);
  assert.equal(all.includes("vercel.app"), false);
  assert.equal(all.includes(SECRET), false);
  assert.equal(all.toLowerCase().includes(COHORT_COOKIE_NAME), false);
  assert.equal(res.headers.get("set-cookie"), null);
});

// ── upstream failure sanitization ─────────────────────────────────────────────

test("authorized-but-failing upstream returns a sanitized status with no body", async () => {
  for (const [status, reason] of [
    [504, "connect_timeout"],
    [504, "headers_timeout"],
    [502, "upstream_error"],
    [502, "redirect_rejected"],
    [502, "byte_mismatch"],
  ] as const) {
    const h = handler({
      streamArtifactImpl: async () => ({ kind: "error", status, reason }),
    });
    const res = await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS));
    assert.equal(res.status, status);
    assert.equal(await res.text(), "", "never forward an upstream body");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
});

test("a transport exception is contained as an opaque 404 (never a stack trace)", async () => {
  const h = handler({
    streamArtifactImpl: async () => {
      throw new Error("boom: https://secret-origin.vercel.app");
    },
  });
  const res = await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS));
  await assertOpaque404(res);
});

// ── diagnostics discipline ────────────────────────────────────────────────────

test("diagnostics are aggregate-only, emitted once, and identity-free", async () => {
  const seen: unknown[] = [];
  const s = await (async () => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "content-encoding": "gzip", "content-length": String(GZIP_BODY.length) });
      res.end(GZIP_BODY);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  })();
  try {
    // Drive the REAL transport through a loopback origin, but keep the route's
    // record/gate logic intact by injecting only the origin.
    const h = createArtifactHandler({
      readEnv: env(),
      nowSeconds: () => NOW + 1,
      onDiagnostics: (d) => seen.push(d),
      streamArtifactImpl: (r) =>
        streamArtifact({ ...r, origin: s.origin, record: { ...r.record, bytes: GZIP_BODY.length } }),
    });
    const res = await h.GET(req(`${COHORT_COOKIE_NAME}=${validToken()}`), ctx(WASM_SEGMENTS));
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    assert.equal(seen.length, 1, "exactly one diagnostic per terminal request");
    const d = seen[0] as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(d).sort(), [
      "chunkCount",
      "firstChunkMs",
      "label",
      "rangeUsed",
      "reason",
      "totalBytes",
      "totalDurationMs",
      "transport",
      "upstreamStatus",
    ]);
    const dump = JSON.stringify(d);
    for (const forbidden of [SECRET, USER_ID, "vercel.app", "127.0.0.1", COHORT_COOKIE_NAME, "member@example.com"]) {
      assert.equal(dump.includes(forbidden), false, `diagnostics must not contain ${forbidden}`);
    }
  } finally {
    await s.close();
  }
});
