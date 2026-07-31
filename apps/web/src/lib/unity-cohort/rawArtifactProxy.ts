/**
 * B6D3B PR-1 — FINAL raw artifact streaming proxy (server-only).
 *
 * Streams a pinned, pre-compressed Unity WebGL artifact from the fixed, validated
 * upstream origin using **raw `node:https` / `node:http` only**.
 *
 * Why raw: the completed B6D3B protected-preview measurement classified the
 * built-in `fetch` transport **FAIL — RANGE** (empty entity body despite a correct
 * `206`) and the raw Node transport **PASS** (exact 8,583,356 bytes, exact SHA-256,
 * gzip preserved, 544-chunk streamed transfer above the ~4.5 MB non-streaming
 * limit). Built-in `fetch` is therefore PROHIBITED for artifact delivery, and none
 * of the broken fetch transport is carried into this final runtime module.
 *
 * Guarantees:
 *   - never buffers the whole body (no `arrayBuffer`/`blob`/`text`/`json`);
 *   - never decompresses or re-encodes (no `zlib`, no gunzip, no Brotli);
 *   - preserves the compressed bytes verbatim;
 *   - response headers are CONSTRUCTED from an allowlist — no upstream header is
 *     forwarded, so `Set-Cookie`, `Server`, `Via`, `X-Powered-By`, `Location`,
 *     upstream cache directives, CDN headers and unknown headers can never leak;
 *   - `ETag` is derived from the PINNED SHA-256, never from upstream;
 *   - redirects are rejected; upstream body/error pages are never forwarded;
 *   - distinct connect / response-header / body-inactivity timeouts;
 *   - client abort destroys the upstream request AND response;
 *   - a declared or streamed byte-count contradiction aborts the stream;
 *   - the pinned manifest byte count is a hard ceiling;
 *   - diagnostics are aggregate-only and emit at most once per terminal request.
 *
 * This module never records a bearer, cookie, token, email, user id, allowlist,
 * artifact origin, full upstream URL, request header, or body byte.
 */

import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";

import {
  artifactETag,
  buildUpstreamArtifactPath,
  MAX_ARTIFACT_BYTES,
  type ArtifactLabel,
  type ArtifactRecord,
} from "./artifactManifest";

export type ArtifactCompletionReason =
  | "complete"
  | "client_abort"
  | "upstream_abort"
  | "connect_timeout"
  | "headers_timeout"
  | "body_timeout"
  | "redirect_rejected"
  | "upstream_error"
  | "byte_mismatch"
  | "size_exceeded"
  | "header_mismatch";

/** Aggregate-only diagnostics. Contains NO identity, origin, URL or body data. */
export interface ArtifactDiagnostics {
  readonly transport: "raw";
  readonly label: ArtifactLabel;
  upstreamStatus: number | null;
  firstChunkMs: number | null;
  totalDurationMs: number | null;
  chunkCount: number;
  totalBytes: number;
  rangeUsed: boolean;
  reason: ArtifactCompletionReason;
}

export interface ArtifactProxyTimeouts {
  readonly connectMs?: number;
  readonly headersMs?: number;
  readonly bodyMs?: number;
}

export interface ArtifactProxyRequest {
  /** Validated BARE origin (scheme + host [+ port]); never request-controlled. */
  readonly origin: string;
  readonly record: ArtifactRecord;
  readonly method: "GET" | "HEAD";
  readonly range?: string | null;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly timeouts?: ArtifactProxyTimeouts;
  readonly onDiagnostics?: (d: ArtifactDiagnostics) => void;
  readonly now?: () => number;
}

export type ArtifactProxyOutcome =
  | {
      readonly kind: "stream";
      readonly status: number;
      readonly headers: Headers;
      readonly body: ReadableStream<Uint8Array> | null;
    }
  | { readonly kind: "error"; readonly status: number; readonly reason: ArtifactCompletionReason };

const DEFAULT_TIMEOUT_MS = 30_000;

const CONTENT_RANGE_SATISFIED_RE = /^bytes (\d+)-(\d+)\/(\d+)$/;
const CONTENT_RANGE_UNSATISFIED_RE = /^bytes \*\/(\d+)$/;

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function resolveTimeouts(req: ArtifactProxyRequest): Required<ArtifactProxyTimeouts> {
  const base = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    connectMs: req.timeouts?.connectMs ?? base,
    headersMs: req.timeouts?.headersMs ?? base,
    bodyMs: req.timeouts?.bodyMs ?? base,
  };
}

function newDiagnostics(label: ArtifactLabel, rangeUsed: boolean): ArtifactDiagnostics {
  return {
    transport: "raw",
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

/**
 * Base protected-delivery headers. Constructed, never forwarded. Deliberately
 * excludes `public`, `s-maxage`, `immutable`, `CDN-Cache-Control` and
 * `x-vercel-enable-rewrite-caching` — protected artifacts are never shared-cached.
 */
function baseProtectedHeaders(): Headers {
  const h = new Headers();
  h.set("Cache-Control", "private, no-store");
  h.set("Vary", "Cookie");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

function parseContentRange(value: string | undefined): { span: number; total: number } | null {
  if (typeof value !== "string") return null;
  const m = CONTENT_RANGE_SATISFIED_RE.exec(value);
  if (m === null) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = Number(m[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) {
    return null;
  }
  if (end < start || total <= 0 || end >= total) return null;
  return { span: end - start + 1, total };
}

/**
 * Parse an unsatisfied-range `Content-Range: bytes * /<total>` header into its
 * numeric total. Returns null when missing or malformed.
 */
function parseUnsatisfiedContentRange(value: string | undefined): { value: string; total: number } | null {
  if (typeof value !== "string") return null;
  const m = CONTENT_RANGE_UNSATISFIED_RE.exec(value);
  if (m === null) return null;
  const total = Number(m[1]);
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  return { value, total };
}

export type ArtifactHeaderBuild =
  | { readonly ok: true; readonly headers: Headers; readonly expectedBytes: number }
  | { readonly ok: false; readonly reason: "header_mismatch" | "byte_mismatch" };

/**
 * Build the outward response headers for a `200`/`206` from the PINNED record plus
 * the minimal validated upstream facts. Fails closed BEFORE streaming on an
 * encoding or length contradiction. Every emitted header is constructed here.
 */
export function buildArtifactHeaders(args: {
  status: 200 | 206;
  record: ArtifactRecord;
  upstreamContentEncoding: string | undefined;
  upstreamContentLength: string | undefined;
  upstreamContentRange: string | undefined;
  upstreamAcceptRanges: string | undefined;
}): ArtifactHeaderBuild {
  const { status, record, upstreamContentEncoding, upstreamContentLength, upstreamContentRange, upstreamAcceptRanges } =
    args;
  const h = baseProtectedHeaders();
  h.set("Content-Type", record.contentType);
  h.set("Content-Disposition", "inline");
  h.set("ETag", artifactETag(record));

  // Content-Encoding must match the pinned expectation exactly (raw preserves
  // bytes, so any divergence is a detectable transformation).
  const ce = upstreamContentEncoding ?? null;
  if (record.contentEncoding === "gzip") {
    if (ce !== "gzip") return { ok: false, reason: "header_mismatch" };
    h.set("Content-Encoding", "gzip");
  } else {
    if (ce !== null && ce !== "identity") return { ok: false, reason: "header_mismatch" };
    h.set("Content-Encoding", "identity");
  }

  // Accept-Ranges is forwarded only as an exact `bytes`; never fabricated.
  if (upstreamAcceptRanges === "bytes") h.set("Accept-Ranges", "bytes");

  if (status === 200) {
    // A declared upstream full length must equal the pinned byte count.
    if (upstreamContentLength !== undefined && upstreamContentLength !== String(record.bytes)) {
      return { ok: false, reason: "byte_mismatch" };
    }
    // The pinned count is authoritative and safe to declare.
    h.set("Content-Length", String(record.bytes));
    return { ok: true, headers: h, expectedBytes: record.bytes };
  }

  // 206 — require a syntactically valid, satisfiable Content-Range whose total
  // matches the pinned byte count.
  const cr = parseContentRange(upstreamContentRange);
  if (cr === null) return { ok: false, reason: "header_mismatch" };
  if (cr.total !== record.bytes) return { ok: false, reason: "byte_mismatch" };
  if (upstreamContentLength !== undefined && upstreamContentLength !== String(cr.span)) {
    return { ok: false, reason: "byte_mismatch" };
  }
  h.set("Content-Range", upstreamContentRange as string);
  h.set("Content-Length", String(cr.span));
  return { ok: true, headers: h, expectedBytes: cr.span };
}

export type Build416Result =
  | { readonly ok: true; readonly headers: Headers }
  | { readonly ok: false; readonly reason: "header_mismatch" | "byte_mismatch" };

/**
 * Build 416 headers — safe range metadata ONLY, and only for a genuinely valid
 * unsatisfied-range response. Fails closed when the upstream `Content-Range` is
 * missing/malformed (`header_mismatch`) or declares a total that differs from the
 * pinned byte count (`byte_mismatch`), so a bogus upstream 416 can never be relayed
 * as an authoritative range answer.
 *
 * Never carries an artifact `Content-Type`, `Content-Encoding`, `Content-Length`,
 * `ETag`, or any part of the upstream body.
 */
export function build416Headers(args: {
  record: ArtifactRecord;
  upstreamContentRange: string | undefined;
  upstreamAcceptRanges: string | undefined;
}): Build416Result {
  const parsed = parseUnsatisfiedContentRange(args.upstreamContentRange);
  if (parsed === null) return { ok: false, reason: "header_mismatch" };
  if (parsed.total !== args.record.bytes) return { ok: false, reason: "byte_mismatch" };
  const h = baseProtectedHeaders();
  h.set("Content-Range", parsed.value);
  if (args.upstreamAcceptRanges === "bytes") h.set("Accept-Ranges", "bytes");
  return { ok: true, headers: h };
}

interface InstrumentArgs {
  readonly source: ReadableStream<Uint8Array>;
  readonly diag: ArtifactDiagnostics;
  readonly startedAt: number;
  readonly now: () => number;
  readonly emit: () => void;
  readonly signal?: AbortSignal;
  readonly bodyMs?: number;
  readonly expectedBytes: number;
  readonly destroyUpstream: () => void;
  readonly onTerminal: () => void;
}

/**
 * Wrap the upstream stream so it counts chunks/bytes without buffering, enforces a
 * body-inactivity timeout, aborts on any byte-count contradiction or size ceiling
 * breach, and emits aggregate diagnostics exactly once at a terminal point.
 */
function instrumentBody(args: InstrumentArgs): ReadableStream<Uint8Array> {
  const { source, diag, startedAt, now, emit, signal, bodyMs, expectedBytes, destroyUpstream, onTerminal } = args;
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

  const finish = (reason: ArtifactCompletionReason) => {
    terminal = true;
    clearTimer();
    diag.totalDurationMs = now() - startedAt;
    diag.reason = reason;
    emit();
    onTerminal();
  };

  const arm = () => {
    if (typeof bodyMs !== "number") return;
    clearTimer();
    timer = setTimeout(() => {
      if (terminal) return;
      finish("body_timeout");
      destroyUpstream();
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
          // A short body is a contradiction against the pinned/declared count.
          finish(diag.totalBytes !== expectedBytes ? "byte_mismatch" : "complete");
          if (diag.reason === "byte_mismatch") {
            destroyUpstream();
            controller.error(new Error("byte_mismatch"));
            return;
          }
          controller.close();
          return;
        }
        if (!firstSeen) {
          firstSeen = true;
          diag.firstChunkMs = now() - startedAt;
        }
        diag.chunkCount += 1;
        diag.totalBytes += value.byteLength;
        // Hard ceilings: never exceed the declared span or the pinned maximum.
        if (diag.totalBytes > expectedBytes || diag.totalBytes > MAX_ARTIFACT_BYTES) {
          finish(diag.totalBytes > MAX_ARTIFACT_BYTES ? "size_exceeded" : "byte_mismatch");
          destroyUpstream();
          controller.error(new Error(diag.reason));
          return;
        }
        controller.enqueue(value);
        arm();
      } catch (err) {
        if (terminal) return;
        finish(signal?.aborted === true ? "client_abort" : "upstream_abort");
        destroyUpstream();
        controller.error(err);
      }
    },
    cancel(reason) {
      if (terminal) return reader.cancel(reason);
      finish("client_abort");
      destroyUpstream();
      return reader.cancel(reason);
    },
  });
}

/**
 * Map an upstream status to an outward status. A `206` OR a `416` is meaningful
 * ONLY when the client actually supplied a `Range` header — an unsolicited
 * range-response is an upstream fault and fails closed (null ⇒ sanitized 502).
 */
function classifyStatus(upstreamStatus: number, rangeRequested: boolean): 200 | 206 | 416 | null {
  if (upstreamStatus === 200) return 200;
  if (upstreamStatus === 206 && rangeRequested) return 206;
  if (upstreamStatus === 416 && rangeRequested) return 416;
  return null;
}

export interface RawClientRequestLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  destroy(error?: Error): void;
  end(): void;
}

export interface RawArtifactProxyDeps {
  /** Injectable request factory so timeout phases are deterministically testable. */
  readonly request?: (
    url: URL,
    options: http.RequestOptions,
    cb: (res: IncomingMessage) => void,
  ) => RawClientRequestLike;
}

/**
 * Stream one pinned artifact. `req.origin` must already be validated as a bare
 * HTTPS origin and `req.record` must already be manifest-resolved — this function
 * performs no authorization and must only be called after the route's gates pass.
 */
export function streamArtifact(
  req: ArtifactProxyRequest,
  deps: RawArtifactProxyDeps = {},
): Promise<ArtifactProxyOutcome> {
  const now = req.now ?? defaultNow;
  const startedAt = now();
  const rangeRequested = typeof req.range === "string" && req.range.length > 0;
  const { connectMs, headersMs, bodyMs } = resolveTimeouts(req);
  const diag = newDiagnostics(req.record.label, rangeRequested);

  let emitted = false;
  const emit = () => {
    if (emitted) return;
    emitted = true;
    req.onDiagnostics?.(diag);
  };

  // Only the fixed validated origin plus the internally derived, pinned versioned
  // path are ever combined. No request text reaches this URL construction.
  const url = new URL(buildUpstreamArtifactPath(req.record), `${req.origin}/`);
  const mod = url.protocol === "https:" ? https : http;
  const requestFn: NonNullable<RawArtifactProxyDeps["request"]> =
    deps.request ??
    ((u: URL, o: http.RequestOptions, cb: (res: IncomingMessage) => void) =>
      mod.request(u, o, cb) as unknown as RawClientRequestLike);

  return new Promise<ArtifactProxyOutcome>((resolve) => {
    let settled = false;
    const resolveOnce = (o: ArtifactProxyOutcome) => {
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

    const fail = (status: number, reason: ArtifactCompletionReason) => {
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
      resolveOnce({ kind: "error", status: 499, reason: "client_abort" });
    };

    const headers: Record<string, string> = {};
    if (rangeRequested) headers["range"] = req.range as string;
    // Request EXACTLY the representation this artifact is pinned to, so the
    // upstream can only answer with the encoding the pinned contract expects.
    //
    // Sending a blanket `gzip` here was a real defect: for an `identity` record
    // (the Unity loader) it permitted the artifact host to return a gzip
    // representation, which `buildArtifactHeaders` then correctly rejected as
    // `header_mismatch` — a sanitized 502 with zero bytes streamed, even though
    // upstream answered 200. The accepted encoding is therefore derived from the
    // pinned record, never hardcoded.
    headers["accept-encoding"] = req.record.contentEncoding === "gzip" ? "gzip" : "identity";

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
        res.destroy(); // never follow or forward a redirect
        fail(502, "redirect_rejected");
        return;
      }

      const mapped = classifyStatus(status, rangeRequested);
      if (mapped === null) {
        res.destroy(); // never forward an upstream error page
        fail(502, "upstream_error");
        return;
      }

      // Read ONLY the minimal upstream facts we need. Nothing else is forwarded.
      const headerValue = (name: string): string | undefined => {
        const v = res.headers[name];
        if (v === undefined) return undefined;
        return Array.isArray(v) ? v.join(", ") : String(v);
      };

      if (mapped === 416) {
        const built416 = build416Headers({
          record: req.record,
          upstreamContentRange: headerValue("content-range"),
          upstreamAcceptRanges: headerValue("accept-ranges"),
        });
        res.destroy(); // discard the upstream 416 body — never forwarded
        if (!built416.ok) {
          fail(502, built416.reason); // missing/malformed/mismatched ⇒ fail closed
          return;
        }
        diag.reason = "complete";
        diag.totalDurationMs = now() - startedAt;
        emit();
        cleanup();
        resolveOnce({ kind: "stream", status: 416, headers: built416.headers, body: null });
        return;
      }

      const built = buildArtifactHeaders({
        status: mapped,
        record: req.record,
        upstreamContentEncoding: headerValue("content-encoding"),
        upstreamContentLength: headerValue("content-length"),
        upstreamContentRange: headerValue("content-range"),
        upstreamAcceptRanges: headerValue("accept-ranges"),
      });
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
        expectedBytes: built.expectedBytes,
        destroyUpstream,
        onTerminal: cleanup,
      });
      resolveOnce({ kind: "stream", status: mapped, headers: built.headers, body });
    });

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
