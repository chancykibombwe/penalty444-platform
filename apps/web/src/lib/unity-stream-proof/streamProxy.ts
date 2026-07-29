/**
 * B6D3B streaming feasibility harness — STREAM PROXY (proof-only).
 *
 * Two disposable research transports that stream a single pinned, pre-compressed
 * Unity WebGL artifact from a fixed, validated upstream origin WITHOUT buffering
 * the whole body, plus the gated request handler that composes them:
 *
 *   - `fetchTransport`  — Node/Next built-in `fetch()` (Undici). Exists to MEASURE
 *     whether the platform transparently decompresses / re-encodes the `.gz`
 *     bytes. Fails closed on detectable contradictions; never claims byte identity
 *     (only a protected-preview measurement can).
 *   - `rawTransport`    — Node `node:http`/`node:https` streaming with NO automatic
 *     decompression, preserving the raw compressed bytes, with distinct bounded
 *     connect / header / body timeout phases.
 *   - `createProofRequestHandler` — builds the GET/HEAD handlers. The LIVE route
 *     uses `allowHttp: false` (HTTPS-only upstream). Loopback `http:` is reachable
 *     ONLY through an explicit test-injected handler (`allowHttp: true`). NODE_ENV
 *     is never used as a security boundary.
 *
 * Neither transport buffers the full body: both stream chunk-by-chunk through an
 * instrumented `ReadableStream` that counts chunks/bytes for aggregate,
 * identity-free diagnostics, resets a body-inactivity timer on progress, and
 * cleans up timers/listeners exactly once at a terminal point. This module must
 * not be imported by gameplay/presentation/realtime/shared or any final
 * `/unity-arena` route.
 */

import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";

import { EXPECTED_RELEASE_ID, type ArtifactLabel, type ArtifactRecord } from "./manifest";
import { evaluateGate, type ProofEnv, type Transport } from "./security";

/**
 * Derive the upstream deployment path for a pinned artifact record.
 *
 * The B6C dedicated artifact deployment does NOT host WebGL Build files at
 * `/Build/…`; it hosts the pinned immutable release under
 * `/releases/<releaseVersion>/…` (see docs/unity-b6c-versioned-staging-delivery.md).
 * The release prefix is therefore the COMPILE-TIME-pinned `EXPECTED_RELEASE_ID`,
 * and the artifact suffix is the already-validated, release-relative fixture
 * `ArtifactRecord.path` (e.g. `Build/<name>.wasm.gz`). NO request query, request
 * pathname text, request header, user-provided release version, or
 * environment-provided pathname is ever used — the prefix is not request-controlled
 * and `UNITY_STREAM_PROOF_ARTIFACT_ORIGIN` stays a bare origin.
 *
 * Example (wasm): `releases/b6b-local-fb840878-d/Build/b6b-local-fb840878-d.wasm.gz`.
 */
export function buildUpstreamArtifactPath(record: ArtifactRecord): string {
  return `releases/${EXPECTED_RELEASE_ID}/${record.path}`;
}

export type CompletionReason =
  | "complete"
  | "client_abort"
  | "upstream_abort"
  | "connect_timeout"
  | "headers_timeout"
  | "body_timeout"
  | "redirect_rejected"
  | "upstream_error"
  | "byte_mismatch"
  | "header_mismatch";

export interface Diagnostics {
  transport: Transport;
  label: ArtifactLabel;
  upstreamStatus: number | null;
  firstChunkMs: number | null;
  totalDurationMs: number | null;
  chunkCount: number;
  totalBytes: number;
  rangeUsed: boolean;
  reason: CompletionReason;
}

export interface ProxyTimeouts {
  /** TCP/TLS connection establishment (raw transport only). */
  readonly connectMs?: number;
  /** Time to receive response headers. */
  readonly headersMs?: number;
  /** Body inactivity timeout: reset on each chunk, active until terminal. */
  readonly bodyMs?: number;
}

export interface ProxyRequest {
  readonly origin: string; // validated bare origin, no trailing slash
  readonly record: ArtifactRecord;
  readonly method: "GET" | "HEAD";
  readonly range?: string | null;
  readonly signal?: AbortSignal; // client abort
  /** Fallback applied to every phase when `timeouts` is not provided. */
  readonly timeoutMs?: number;
  readonly timeouts?: ProxyTimeouts;
  readonly onDiagnostics?: (d: Diagnostics) => void;
  readonly now?: () => number;
}

export type ProxyOutcome =
  | {
      readonly kind: "stream";
      readonly status: number;
      readonly headers: Headers;
      readonly body: ReadableStream<Uint8Array> | null;
    }
  | { readonly kind: "error"; readonly status: number; readonly reason: CompletionReason };

const DEFAULT_TIMEOUT_MS = 30_000;

/** Response headers that must never be forwarded from the upstream. */
const STRIPPED_UPSTREAM_HEADERS = new Set([
  "server",
  "via",
  "x-powered-by",
  "location",
  "set-cookie",
  "cache-control",
  "cdn-cache-control",
  "surrogate-control",
  "age",
  "expires",
  "etag",
  "host",
  "x-vercel-id",
  "x-vercel-cache",
  "x-served-by",
  "cf-ray",
  "cf-cache-status",
  "report-to",
  "nel",
]);

const CONTENT_RANGE_SATISFIED_RE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;
const CONTENT_RANGE_UNSATISFIED_RE = /^bytes \*\/(\d+)$/;

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function resolveTimeouts(req: ProxyRequest): Required<ProxyTimeouts> {
  const base = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    connectMs: req.timeouts?.connectMs ?? base,
    headersMs: req.timeouts?.headersMs ?? base,
    bodyMs: req.timeouts?.bodyMs ?? base,
  };
}

function newDiagnostics(transport: Transport, label: ArtifactLabel, rangeUsed: boolean): Diagnostics {
  return {
    transport,
    label,
    upstreamStatus: null,
    firstChunkMs: null,
    totalDurationMs: null,
    chunkCount: 0,
    totalBytes: 0,
    rangeUsed,
    reason: "upstream_error",
  };
}

function baseHeaders(): Headers {
  const h = new Headers();
  h.set("Cache-Control", "private, no-store");
  h.set("Vary", "Authorization");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

function safeContentRange(v: string | null): string | null {
  if (v === null) return null;
  if (CONTENT_RANGE_SATISFIED_RE.test(v) || CONTENT_RANGE_UNSATISFIED_RE.test(v)) return v;
  return null;
}

function contentRangeSpan(v: string | null): number | null {
  if (v === null) return null;
  const m = CONTENT_RANGE_SATISFIED_RE.exec(v);
  if (m === null) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return end - start + 1;
}

export type HeaderBuild =
  | { readonly ok: true; readonly headers: Headers }
  | { readonly ok: false; readonly reason: "header_mismatch" | "byte_mismatch" };

/**
 * Build sanitized response headers for a 200/206, knowing the transport, the
 * pinned record and the (already stripped) safe upstream headers. Fails closed
 * before streaming on encoding/length contradictions.
 */
export function buildStreamHeaders(args: {
  transport: Transport;
  status: 200 | 206;
  record: ArtifactRecord;
  upstream: Headers;
}): HeaderBuild {
  const { transport, status, record, upstream } = args;
  const h = baseHeaders();
  h.set("Content-Type", record.contentType);

  // Content-Encoding consistency.
  const ce = upstream.get("content-encoding");
  if (record.contentEncoding === "gzip") {
    if (ce !== "gzip") return { ok: false, reason: "header_mismatch" };
    h.set("Content-Encoding", "gzip");
  } else {
    if (ce !== null && ce !== "identity") return { ok: false, reason: "header_mismatch" };
    h.set("Content-Encoding", "identity");
  }

  // Accept-Ranges: forward ONLY an exact `bytes`; never fabricate.
  if (upstream.get("accept-ranges") === "bytes") h.set("Accept-Ranges", "bytes");

  const cl = upstream.get("content-length");
  if (status === 200) {
    if (transport === "raw") {
      // Raw preserves bytes: a declared full length must equal the pinned count.
      if (cl !== null) {
        if (cl !== String(record.bytes)) return { ok: false, reason: "byte_mismatch" };
        h.set("Content-Length", cl);
      }
      // Absent → omit and verify via diagnostics at terminal completion.
    } else {
      // Fetch may transparently transform the body. For gzip, omit Content-Length
      // entirely. For identity, only echo a length that matches the pinned count.
      if (record.contentEncoding === "identity" && cl !== null && cl === String(record.bytes)) {
        h.set("Content-Length", cl);
      }
    }
  } else {
    // 206 — require a syntactically valid satisfiable Content-Range.
    const cr = safeContentRange(upstream.get("content-range"));
    const span = cr === null ? null : contentRangeSpan(cr);
    if (cr === null || span === null) return { ok: false, reason: "header_mismatch" };
    h.set("Content-Range", cr);
    // Content-Length only when consistent with the partial span (and not a
    // possibly-transformed fetch gzip body).
    const omitFetchGzip = transport === "fetch" && record.contentEncoding === "gzip";
    if (!omitFetchGzip && cl !== null && cl === String(span)) h.set("Content-Length", cl);
  }

  return { ok: true, headers: h };
}

/** 416 headers: safe Content-Range only; no artifact Content-Type/Encoding/Length. */
export function build416Headers(upstream: Headers): Headers {
  const h = baseHeaders();
  const cr = safeContentRange(upstream.get("content-range"));
  if (cr !== null) h.set("Content-Range", cr);
  if (upstream.get("accept-ranges") === "bytes") h.set("Accept-Ranges", "bytes");
  return h;
}

/** Expected forwarded byte count for verification (raw only). */
function rawExpectedBytes(status: 200 | 206, record: ArtifactRecord, upstream: Headers): number | undefined {
  if (status === 200) return record.bytes;
  const span = contentRangeSpan(safeContentRange(upstream.get("content-range")));
  return span ?? undefined;
}

interface InstrumentArgs {
  readonly source: ReadableStream<Uint8Array>;
  readonly diag: Diagnostics;
  readonly startedAt: number;
  readonly now: () => number;
  readonly emit: () => void;
  readonly signal?: AbortSignal;
  readonly bodyMs?: number;
  readonly expectedBytes?: number;
  readonly destroyUpstream: () => void;
  /**
   * Upstream teardown for the CONSUMER-CANCEL path. For raw this destroys the
   * request/response; for fetch it is a noop because cancelling the reader already
   * aborts the Undici request (an extra AbortController.abort() there produces a
   * spurious unhandled rejection).
   */
  readonly cancelUpstream?: () => void;
  readonly onTerminal: () => void;
}

/**
 * Wrap a source stream so it counts chunks/bytes, enforces a body-inactivity
 * timeout, verifies the final byte count (when expected), and emits identity-free
 * diagnostics exactly once at a terminal point (complete / byte_mismatch /
 * body_timeout / client cancel / abort / error). Never concatenates or retains
 * the full body; resets the inactivity timer on each chunk; cleans up exactly
 * once via `onTerminal`.
 */
function instrumentBody(args: InstrumentArgs): ReadableStream<Uint8Array> {
  const { source, diag, startedAt, now, emit, signal, bodyMs, expectedBytes, destroyUpstream, cancelUpstream, onTerminal } = args;
  const reader = source.getReader();
  let firstSeen = false;
  let terminal = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // Body inactivity timer: armed at stream start, reset on each chunk, cleared at
  // any terminal point. A stall fires body_timeout and destroys upstream work.
  const arm = () => {
    if (typeof bodyMs !== "number") return;
    clearTimer();
    timer = setTimeout(() => {
      if (terminal) return;
      terminal = true;
      clearTimer();
      diag.totalDurationMs = now() - startedAt;
      diag.reason = "body_timeout";
      emit();
      destroyUpstream();
      onTerminal();
      try {
        controllerRef?.error(new Error("body_timeout"));
      } catch {
        /* already closed */
      }
    }, bodyMs);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      arm();
    },
    async pull(controller) {
      if (terminal) return;
      try {
        const { done, value } = await reader.read();
        if (terminal) return;
        if (done) {
          terminal = true;
          clearTimer();
          diag.totalDurationMs = now() - startedAt;
          diag.reason =
            typeof expectedBytes === "number" && diag.totalBytes !== expectedBytes
              ? "byte_mismatch"
              : "complete";
          emit();
          onTerminal();
          controller.close();
          return;
        }
        if (!firstSeen) {
          firstSeen = true;
          diag.firstChunkMs = now() - startedAt;
        }
        diag.chunkCount += 1;
        diag.totalBytes += value.byteLength;
        controller.enqueue(value);
        arm();
      } catch (err) {
        if (terminal) return;
        terminal = true;
        clearTimer();
        diag.totalDurationMs = now() - startedAt;
        diag.reason = signal?.aborted ? "client_abort" : "upstream_abort";
        emit();
        destroyUpstream();
        onTerminal();
        controller.error(err);
      }
    },
    cancel(reason) {
      if (terminal) return reader.cancel(reason);
      terminal = true;
      clearTimer();
      diag.totalDurationMs = now() - startedAt;
      diag.reason = "client_abort";
      emit();
      (cancelUpstream ?? destroyUpstream)();
      onTerminal();
      return reader.cancel(reason);
    },
  });
}

function classifyStatus(upstreamStatus: number, rangeRequested: boolean): 200 | 206 | 416 | null {
  if (upstreamStatus === 200) return 200;
  if (upstreamStatus === 206 && rangeRequested) return 206;
  if (upstreamStatus === 416) return 416;
  return null; // anything else is an upstream error for this proof
}

// ── Transport A: built-in fetch ─────────────────────────────────────────────
export async function fetchTransport(req: ProxyRequest): Promise<ProxyOutcome> {
  const now = req.now ?? defaultNow;
  const startedAt = now();
  const rangeRequested = typeof req.range === "string" && req.range.length > 0;
  const { headersMs, bodyMs } = resolveTimeouts(req);
  const diag = newDiagnostics("fetch", req.record.label, rangeRequested);

  let emitted = false;
  const emit = () => {
    if (emitted) return;
    emitted = true;
    req.onDiagnostics?.(diag);
  };

  const ac = new AbortController();
  let phase: "header" | "body" | "done" = "header";
  let hint: CompletionReason | null = null;
  let cleaned = false;

  const onClientAbort = () => {
    hint = "client_abort";
    ac.abort();
  };
  const headerTimer = setTimeout(() => {
    if (phase === "header") {
      hint = "headers_timeout";
      ac.abort();
    }
  }, headersMs);
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(headerTimer);
    req.signal?.removeEventListener("abort", onClientAbort);
  };

  if (req.signal?.aborted) onClientAbort();
  else req.signal?.addEventListener("abort", onClientAbort, { once: true });

  const url = new URL(buildUpstreamArtifactPath(req.record), req.origin + "/");
  const reqHeaders = new Headers();
  if (rangeRequested) reqHeaders.set("Range", req.range as string);

  const failEarly = (status: number, reason: CompletionReason): ProxyOutcome => {
    diag.reason = reason;
    diag.totalDurationMs = now() - startedAt;
    emit();
    cleanup();
    return { kind: "error", status, reason };
  };

  try {
    const res = await fetch(url, {
      method: req.method,
      redirect: "manual",
      headers: reqHeaders,
      signal: ac.signal,
    });
    // Headers received → close the header phase; the body phase timer lives inside
    // the instrumented stream.
    clearTimeout(headerTimer);
    phase = "body";
    diag.upstreamStatus = res.status;

    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel();
      return failEarly(502, "redirect_rejected");
    }

    const mapped = classifyStatus(res.status, rangeRequested);
    if (mapped === null) {
      await res.body?.cancel();
      return failEarly(502, "upstream_error");
    }

    if (mapped === 416) {
      await res.body?.cancel();
      diag.reason = "complete";
      diag.totalDurationMs = now() - startedAt;
      emit();
      cleanup();
      return { kind: "stream", status: 416, headers: build416Headers(res.headers), body: null };
    }

    const built = buildStreamHeaders({ transport: "fetch", status: mapped, record: req.record, upstream: res.headers });
    if (!built.ok) {
      await res.body?.cancel();
      return failEarly(502, built.reason);
    }

    if (req.method === "HEAD" || res.body === null) {
      await res.body?.cancel();
      diag.reason = "complete";
      diag.totalDurationMs = now() - startedAt;
      emit();
      cleanup();
      return { kind: "stream", status: mapped, headers: built.headers, body: null };
    }

    phase = "done";
    const body = instrumentBody({
      source: res.body,
      diag,
      startedAt,
      now,
      emit,
      signal: req.signal,
      bodyMs,
      // Fetch may transparently transform the body → do not enforce byte identity.
      expectedBytes: undefined,
      destroyUpstream: () => {
        try {
          ac.abort();
        } catch {
          /* noop */
        }
      },
      // Consumer cancel: cancelling the reader already aborts the Undici request.
      cancelUpstream: () => {},
      onTerminal: cleanup,
    });
    return { kind: "stream", status: mapped, headers: built.headers, body };
  } catch {
    const reason: CompletionReason =
      hint === "client_abort"
        ? "client_abort"
        : hint === "headers_timeout"
          ? "headers_timeout"
          : "upstream_error";
    const status = reason === "headers_timeout" ? 504 : reason === "client_abort" ? 499 : 502;
    return failEarly(status, reason);
  }
}

// ── Transport B: raw node:http / node:https ─────────────────────────────────
export interface RawClientRequestLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  destroy(error?: Error): void;
  end(): void;
}

export interface RawTransportDeps {
  /** Injectable request factory for deterministic connect-timeout tests. */
  readonly request?: (
    url: URL,
    options: http.RequestOptions,
    cb: (res: IncomingMessage) => void,
  ) => RawClientRequestLike;
}

export function rawTransport(req: ProxyRequest, deps: RawTransportDeps = {}): Promise<ProxyOutcome> {
  const now = req.now ?? defaultNow;
  const startedAt = now();
  const rangeRequested = typeof req.range === "string" && req.range.length > 0;
  const { connectMs, headersMs, bodyMs } = resolveTimeouts(req);
  const diag = newDiagnostics("raw", req.record.label, rangeRequested);

  let emitted = false;
  const emit = () => {
    if (emitted) return;
    emitted = true;
    req.onDiagnostics?.(diag);
  };

  const url = new URL(buildUpstreamArtifactPath(req.record), req.origin + "/");
  const mod = url.protocol === "https:" ? https : http;
  const requestFn: NonNullable<RawTransportDeps["request"]> =
    deps.request ??
    ((u: URL, o: http.RequestOptions, cb: (res: IncomingMessage) => void) =>
      mod.request(u, o, cb) as unknown as RawClientRequestLike);

  return new Promise<ProxyOutcome>((resolve) => {
    let settled = false;
    const resolveOnce = (o: ProxyOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };

    let finished = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let headerTimer: ReturnType<typeof setTimeout> | null = null;
    let responseRef: IncomingMessage | null = null;

    const clearConnect = () => {
      if (connectTimer !== null) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    };
    const clearHeader = () => {
      if (headerTimer !== null) {
        clearTimeout(headerTimer);
        headerTimer = null;
      }
    };

    const destroyUpstream = () => {
      try {
        responseRef?.destroy();
      } catch {
        /* noop */
      }
      try {
        clientReq.destroy();
      } catch {
        /* noop */
      }
    };

    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearConnect();
      clearHeader();
      req.signal?.removeEventListener("abort", onClientAbort);
    };

    const fail = (status: number, reason: CompletionReason) => {
      diag.reason = reason;
      diag.totalDurationMs = now() - startedAt;
      emit();
      destroyUpstream();
      cleanup();
      resolveOnce({ kind: "error", status, reason });
    };

    const onClientAbort = () => {
      diag.reason = "client_abort";
      diag.totalDurationMs = now() - startedAt;
      emit();
      destroyUpstream();
      cleanup();
      // If the stream outcome was already returned this is a no-op; the stream
      // errors via destroyUpstream and the instrument reports client_abort.
      resolveOnce({ kind: "error", status: 499, reason: "client_abort" });
    };

    const headers: Record<string, string> = {};
    if (rangeRequested) headers["range"] = req.range as string;

    const clientReq = requestFn(url, { method: req.method, headers }, (res) => {
      if (finished) {
        res.destroy();
        return;
      }
      clearConnect();
      clearHeader();
      responseRef = res;
      const status = res.statusCode ?? 0;
      diag.upstreamStatus = status;

      if (status >= 300 && status < 400) {
        fail(502, "redirect_rejected");
        return;
      }

      const mapped = classifyStatus(status, rangeRequested);
      if (mapped === null) {
        fail(502, "upstream_error");
        return;
      }

      const upstreamHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v === undefined) continue;
        const key = k.toLowerCase();
        if (STRIPPED_UPSTREAM_HEADERS.has(key)) continue;
        upstreamHeaders.set(key, Array.isArray(v) ? v.join(", ") : String(v));
      }

      if (mapped === 416) {
        res.destroy(); // discard the upstream 416 body — never forward it
        diag.reason = "complete";
        diag.totalDurationMs = now() - startedAt;
        emit();
        cleanup();
        resolveOnce({ kind: "stream", status: 416, headers: build416Headers(upstreamHeaders), body: null });
        return;
      }

      const built = buildStreamHeaders({ transport: "raw", status: mapped, record: req.record, upstream: upstreamHeaders });
      if (!built.ok) {
        res.destroy();
        fail(502, built.reason);
        return;
      }

      if (req.method === "HEAD") {
        res.destroy();
        diag.reason = "complete";
        diag.totalDurationMs = now() - startedAt;
        emit();
        cleanup();
        resolveOnce({ kind: "stream", status: mapped, headers: built.headers, body: null });
        return;
      }

      const web = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
      const body = instrumentBody({
        source: web,
        diag,
        startedAt,
        now,
        emit,
        signal: req.signal,
        bodyMs,
        expectedBytes: rawExpectedBytes(mapped, req.record, upstreamHeaders),
        destroyUpstream,
        onTerminal: cleanup,
      });
      resolveOnce({ kind: "stream", status: mapped, headers: built.headers, body });
    });

    // Distinct bounded phases.
    connectTimer = setTimeout(() => {
      if (finished) return;
      fail(504, "connect_timeout");
    }, connectMs);

    clientReq.on("socket", (socketArg: unknown) => {
      const socket = socketArg as import("node:net").Socket;
      const onConnected = () => {
        if (finished) return;
        clearConnect();
        if (headerTimer === null) {
          headerTimer = setTimeout(() => {
            if (finished) return;
            fail(504, "headers_timeout");
          }, headersMs);
        }
      };
      if (socket.connecting) {
        socket.once("connect", onConnected);
        socket.once("secureConnect", onConnected);
      } else {
        onConnected();
      }
    });

    clientReq.on("error", () => {
      if (finished) return;
      fail(502, "upstream_error");
    });

    if (req.signal) {
      if (req.signal.aborted) onClientAbort();
      else req.signal.addEventListener("abort", onClientAbort, { once: true });
    }

    if (!finished) clientReq.end();
  });
}

export function runTransport(transport: Transport, req: ProxyRequest): Promise<ProxyOutcome> {
  return transport === "raw" ? rawTransport(req) : fetchTransport(req);
}

// ── Gated request handler (composed here so route.ts exports only route fields) ─
export interface ProofHandlerConfig {
  /**
   * TEST-ONLY: permit a loopback `http:` upstream. The live route omits this
   * (defaults to false) so deployed GET/HEAD require an `https:` origin. This is
   * an explicit dependency-injection seam, NOT a NODE_ENV check.
   */
  readonly allowHttp?: boolean;
  readonly readEnv?: () => ProofEnv;
  readonly runTransportImpl?: (transport: Transport, req: ProxyRequest) => Promise<ProxyOutcome>;
  readonly onDiagnostics?: (d: Diagnostics) => void;
}

export interface ProofRouteContext {
  params: Promise<{ transport: string; path?: string[] }>;
}

function defaultReadEnv(): ProofEnv {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    UNITY_STREAM_PROOF_ENABLED: process.env.UNITY_STREAM_PROOF_ENABLED,
    UNITY_STREAM_PROOF_BEARER: process.env.UNITY_STREAM_PROOF_BEARER,
    UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: process.env.UNITY_STREAM_PROOF_ARTIFACT_ORIGIN,
  };
}

/** Minimal server logger: permitted aggregate fields only; no secret/origin/URL. */
function defaultProofLogger(d: Diagnostics): void {
  console.info(
    JSON.stringify({
      scope: "unity-stream-proof",
      transport: d.transport,
      label: d.label,
      upstreamStatus: d.upstreamStatus,
      firstChunkMs: d.firstChunkMs,
      totalDurationMs: d.totalDurationMs,
      chunkCount: d.chunkCount,
      totalBytes: d.totalBytes,
      rangeUsed: d.rangeUsed,
      reason: d.reason,
    }),
  );
}

/** Single opaque denial — identical for every failed gate; leaks nothing. */
export function opaqueNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function createProofRequestHandler(config: ProofHandlerConfig = {}) {
  const allowHttp = config.allowHttp === true;
  const readEnv = config.readEnv ?? defaultReadEnv;
  const run = config.runTransportImpl ?? runTransport;
  const onDiagnostics = config.onDiagnostics ?? defaultProofLogger;

  async function handle(req: Request, ctx: ProofRouteContext, method: "GET" | "HEAD"): Promise<Response> {
    const { transport, path } = await ctx.params;

    const gate = evaluateGate({
      env: readEnv(),
      authHeader: req.headers.get("authorization"),
      transport,
      pathSegments: path ?? [],
      originOptions: { allowHttp },
    });

    if (!gate.ok) return opaqueNotFound();

    const outcome = await run(gate.transport, {
      origin: gate.origin,
      record: gate.record,
      method,
      range: req.headers.get("range"),
      signal: req.signal,
      onDiagnostics,
    });

    if (outcome.kind === "error") {
      return new Response(null, {
        status: outcome.status,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Authorization",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return new Response(outcome.body, { status: outcome.status, headers: outcome.headers });
  }

  return {
    GET: (req: Request, ctx: ProofRouteContext) => handle(req, ctx, "GET"),
    HEAD: (req: Request, ctx: ProofRouteContext) => handle(req, ctx, "HEAD"),
  };
}
