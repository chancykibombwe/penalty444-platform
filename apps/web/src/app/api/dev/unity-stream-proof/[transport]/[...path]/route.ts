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
 * The LIVE handlers require an `https:` artifact origin (`allowHttp` defaults to
 * false). Loopback `http:` is reachable only through the test-injected handler
 * (`createProofRequestHandler({ allowHttp: true })`). No proof environment
 * variables are configured, so a deployed instance always returns 404.
 *
 * Only route-segment fields are exported (runtime, dynamic, GET, HEAD); the
 * reusable, injectable handler lives in the proof lib so tests can supply
 * loopback-HTTP injection without adding non-route exports here.
 */

import { createProofRequestHandler } from "../../../../../../lib/unity-stream-proof/streamProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const liveHandlers = createProofRequestHandler(); // allowHttp defaults to false → HTTPS-only

export const GET = liveHandlers.GET;
export const HEAD = liveHandlers.HEAD;
