/**
 * B6D3B streaming feasibility harness — PROOF-ONLY ROUTE.
 *
 *   /api/dev/unity-stream-proof/[transport]/[...path]
 *
 * Disposable research route that streams a single pinned, pre-compressed Unity
 * WebGL artifact through one of two transports (`fetch` | `raw`) so a later
 * PROTECTED-PREVIEW MEASUREMENT can decide whether Vercel/Next can stream the
 * `.wasm.gz` without buffering, decompressing, re-encoding, or corrupting it.
 *
 * This is NOT the final `/unity-arena/player` route, NOT the final
 * `/unity-arena/artifact/[...path]` route, NOT a cohort/session system, NOT a
 * player-facing feature, NOT a Unity renderer, and NOT a production route. It
 * must return an INDISTINGUISHABLE 404 whenever any gate fails and in production.
 *
 * No proof environment variables are configured, so a deployed instance always
 * returns 404. Do not configure them here.
 */

import {
  evaluateGate,
  type ProofEnv,
} from "../../../../../../lib/unity-stream-proof/security";
import {
  runTransport,
  type Diagnostics,
} from "../../../../../../lib/unity-stream-proof/streamProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ transport: string; path?: string[] }>;
};

/** Single opaque denial — identical for every failed gate; leaks nothing. */
function opaqueNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Minimal server-side logger: permitted aggregate fields only; no secrets, no
 * origin, no URL, no identity, no body bytes. */
function emitProofDiagnostics(d: Diagnostics): void {
  const safe = {
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
  };
  console.info(JSON.stringify(safe));
}

function readEnv(): ProofEnv {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    UNITY_STREAM_PROOF_ENABLED: process.env.UNITY_STREAM_PROOF_ENABLED,
    UNITY_STREAM_PROOF_BEARER: process.env.UNITY_STREAM_PROOF_BEARER,
    UNITY_STREAM_PROOF_ARTIFACT_ORIGIN: process.env.UNITY_STREAM_PROOF_ARTIFACT_ORIGIN,
  };
}

async function handle(req: Request, ctx: RouteContext, method: "GET" | "HEAD"): Promise<Response> {
  const { transport, path } = await ctx.params;

  const gate = evaluateGate({
    env: readEnv(),
    authHeader: req.headers.get("authorization"),
    transport,
    pathSegments: path ?? [],
    // http permitted for loopback only (local test injection); preview = https.
    originOptions: { allowHttp: true },
  });

  if (!gate.ok) return opaqueNotFound();

  const outcome = await runTransport(gate.transport, {
    origin: gate.origin,
    record: gate.record,
    method,
    range: req.headers.get("range"),
    signal: req.signal,
    onDiagnostics: emitProofDiagnostics,
  });

  if (outcome.kind === "error") {
    // Post-auth upstream failure — not a gate denial; reveal no detail/origin.
    return new Response(null, {
      status: outcome.status,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Authorization",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(outcome.body, {
    status: outcome.status,
    headers: outcome.headers,
  });
}

export function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(req, ctx, "GET");
}

export function HEAD(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(req, ctx, "HEAD");
}
