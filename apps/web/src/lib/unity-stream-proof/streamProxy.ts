/**
 * B6D3B streaming feasibility harness — STREAM PROXY (proof-only).
 *
 * Two disposable research transports that stream a single pinned, pre-compressed
 * Unity WebGL artifact from a fixed, validated upstream origin WITHOUT buffering
 * the whole body:
 *
 *   - `fetchTransport`  — Node/Next built-in `fetch()` (Undici). Exists to MEASURE
 *     whether the platform transparently decompresses / re-encodes the `.gz`
 *     bytes. Fails closed on detectable contradictions; never claims byte identity
 *     (only a protected-preview measurement can).
 *   - `rawTransport`    — Node `node:http`/`node:https` streaming with NO automatic
 *     decompression, preserving the raw compressed bytes.
 *
 * Neither transport buffers the full body: both stream chunk-by-chunk through an
 * instrumented `ReadableStream` that counts chunks/bytes for aggregate,
 * identity-free diagnostics. This module performs the only outbound request in
 * the harness and must not be imported by gameplay/presentation/realtime/shared
 * or any final `/unity-arena` route.
 */

import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

import type { ArtifactLabel, ArtifactRecord } from "./manifest";
import type { Transport } from "./security";

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

export interface ProxyRequest {
  readonly origin: string; // validated bare origin, no trailing slash
  readonly record: ArtifactRecord;
  readonly method: "GET" | "HEAD";
  readonly range?: string | null;
  readonly signal?: AbortSignal; // client abort
  readonly timeoutMs?: number; // bounded connect/header/body timeout
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
  "age",
  "expires",
  "host",
  "x-vercel-id",
  "x-vercel-cache",
  "x-served-by",
  "cf-ray",
  "report-to",
  "nel",
]);

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
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

/**
 * Build the sanitized success response headers. Only allowlisted values are set;
 * the upstream origin and unsafe upstream headers are never forwarded.
 */
function buildSuccessHeaders(
  record: ArtifactRecord,
  status: number,
  upstream: Headers,
): Headers {
  const h = new Headers();
  h.set("Cache-Control", "private, no-store");
  h.set("Vary", "Authorization");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Content-Type", record.contentType);
  h.set("Content-Encoding", record.contentEncoding);
  h.set("Accept-Ranges", upstream.get("accept-ranges") ?? "bytes");

  const upstreamLen = upstream.get("content-length");
  if (status === 206) {
    const cr = upstream.get("content-range");
    if (cr && !STRIPPED_UPSTREAM_HEADERS.has("content-range")) h.set("Content-Range", cr);
    if (upstreamLen) h.set("Content-Length", upstreamLen);
  } else if (status === 200) {
    // Only assert a Content-Length we can vouch for: it must equal the pinned
    // compressed byte count AND match what the upstream declared.
    if (upstreamLen && upstreamLen === String(record.bytes)) {
      h.set("Content-Length", upstreamLen);
    }
  }
  return h;
}

/**
 * Wrap a source stream so it counts chunks/bytes and emits identity-free
 * diagnostics exactly once at a terminal point (complete / client cancel /
 * error). Never concatenates or retains the full body.
 */
function instrumentBody(
  source: ReadableStream<Uint8Array>,
  diag: Diagnostics,
  startedAt: number,
  now: () => number,
  emit: () => void,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let firstSeen = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          diag.totalDurationMs = now() - startedAt;
          diag.reason = "complete";
          emit();
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
      } catch (err) {
        diag.totalDurationMs = now() - startedAt;
        diag.reason = signal?.aborted ? "client_abort" : "upstream_abort";
        emit();
        controller.error(err);
      }
    },
    cancel(reason) {
      diag.totalDurationMs = now() - startedAt;
      diag.reason = "client_abort";
      emit();
      return reader.cancel(reason);
    },
  });
}

function classifyStatus(upstreamStatus: number, rangeRequested: boolean): number | null {
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
  const diag = newDiagnostics("fetch", req.record.label, rangeRequested);
  let emitted = false;
  const emit = () => {
    if (emitted) return;
    emitted = true;
    req.onDiagnostics?.(diag);
  };

  const url = new URL(req.record.path, req.origin + "/");
  const ac = new AbortController();
  let hint: CompletionReason | null = null;
  const timer = setTimeout(() => {
    hint = "body_timeout";
    ac.abort();
  }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onClientAbort = () => {
    hint = "client_abort";
    ac.abort();
  };
  if (req.signal?.aborted) onClientAbort();
  else req.signal?.addEventListener("abort", onClientAbort, { once: true });

  const reqHeaders = new Headers();
  if (rangeRequested) reqHeaders.set("Range", req.range as string);

  try {
    const res = await fetch(url, {
      method: req.method,
      redirect: "manual",
      headers: reqHeaders,
      signal: ac.signal,
    });
    diag.upstreamStatus = res.status;

    // Reject any redirect (manual → status 3xx, or opaqueredirect).
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel();
      diag.reason = "redirect_rejected";
      emit();
      return { kind: "error", status: 502, reason: "redirect_rejected" };
    }

    const mapped = classifyStatus(res.status, rangeRequested);
    if (mapped === null) {
      await res.body?.cancel();
      diag.reason = "upstream_error";
      emit();
      return { kind: "error", status: 502, reason: "upstream_error" };
    }

    // Fetch fail-closed: for a gzip artifact, Undici transparently decompresses
    // and DROPS `content-encoding`. If we expected gzip but the upstream response
    // no longer advertises gzip, the bytes were transformed → fail closed.
    if (
      (mapped === 200 || mapped === 206) &&
      req.record.contentEncoding === "gzip" &&
      res.headers.get("content-encoding") !== "gzip"
    ) {
      await res.body?.cancel();
      diag.reason = "header_mismatch";
      emit();
      return { kind: "error", status: 502, reason: "header_mismatch" };
    }

    const headers = buildSuccessHeaders(req.record, mapped, res.headers);

    if (req.method === "HEAD") {
      await res.body?.cancel();
      diag.totalDurationMs = now() - startedAt;
      diag.reason = "complete";
      emit();
      return { kind: "stream", status: mapped, headers, body: null };
    }

    if (res.body === null) {
      diag.totalDurationMs = now() - startedAt;
      diag.reason = "complete";
      emit();
      return { kind: "stream", status: mapped, headers, body: null };
    }

    const body = instrumentBody(res.body, diag, startedAt, now, emit, req.signal);
    return { kind: "stream", status: mapped, headers, body };
  } catch (err) {
    const reason: CompletionReason =
      hint === "client_abort"
        ? "client_abort"
        : hint === "body_timeout"
          ? "body_timeout"
          : "upstream_error";
    diag.reason = reason;
    emit();
    const status = reason === "body_timeout" ? 504 : reason === "client_abort" ? 499 : 502;
    return { kind: "error", status, reason };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onClientAbort);
  }
}

// ── Transport B: raw node:http / node:https ─────────────────────────────────
export function rawTransport(req: ProxyRequest): Promise<ProxyOutcome> {
  const now = req.now ?? defaultNow;
  const startedAt = now();
  const rangeRequested = typeof req.range === "string" && req.range.length > 0;
  const diag = newDiagnostics("raw", req.record.label, rangeRequested);
  let emitted = false;
  const emit = () => {
    if (emitted) return;
    emitted = true;
    req.onDiagnostics?.(diag);
  };

  const url = new URL(req.record.path, req.origin + "/");
  const mod = url.protocol === "https:" ? https : http;

  return new Promise<ProxyOutcome>((resolve) => {
    let settled = false;
    const done = (o: ProxyOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };

    const headers: Record<string, string> = {};
    if (rangeRequested) headers["range"] = req.range as string;

    const clientReq = mod.request(
      url,
      { method: req.method, headers },
      (res) => {
        const status = res.statusCode ?? 0;
        diag.upstreamStatus = status;

        if (status >= 300 && status < 400) {
          res.destroy();
          diag.reason = "redirect_rejected";
          emit();
          done({ kind: "error", status: 502, reason: "redirect_rejected" });
          return;
        }

        const mapped = classifyStatus(status, rangeRequested);
        if (mapped === null) {
          res.destroy();
          diag.reason = "upstream_error";
          emit();
          done({ kind: "error", status: 502, reason: "upstream_error" });
          return;
        }

        const upstreamHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          const key = k.toLowerCase();
          if (STRIPPED_UPSTREAM_HEADERS.has(key)) continue;
          upstreamHeaders.set(key, Array.isArray(v) ? v.join(", ") : String(v));
        }
        const outHeaders = buildSuccessHeaders(req.record, mapped, upstreamHeaders);

        if (req.method === "HEAD") {
          res.destroy();
          diag.totalDurationMs = now() - startedAt;
          diag.reason = "complete";
          emit();
          done({ kind: "stream", status: mapped, headers: outHeaders, body: null });
          return;
        }

        const web = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
        const body = instrumentBody(web, diag, startedAt, now, emit, req.signal);
        done({ kind: "stream", status: mapped, headers: outHeaders, body });
      },
    );

    clientReq.setTimeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
      diag.reason = "headers_timeout";
      emit();
      clientReq.destroy();
      done({ kind: "error", status: 504, reason: "headers_timeout" });
    });

    clientReq.on("error", () => {
      diag.reason = diag.reason === "headers_timeout" ? "headers_timeout" : "upstream_error";
      emit();
      done({ kind: "error", status: 502, reason: "upstream_error" });
    });

    const onClientAbort = () => {
      diag.reason = "client_abort";
      emit();
      clientReq.destroy();
      done({ kind: "error", status: 499, reason: "client_abort" });
    };
    if (req.signal) {
      if (req.signal.aborted) onClientAbort();
      else req.signal.addEventListener("abort", onClientAbort, { once: true });
    }

    clientReq.end();
  });
}

export function runTransport(transport: Transport, req: ProxyRequest): Promise<ProxyOutcome> {
  return transport === "raw" ? rawTransport(req) : fetchTransport(req);
}
