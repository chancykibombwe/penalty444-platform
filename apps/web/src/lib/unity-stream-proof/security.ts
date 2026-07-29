/**
 * B6D3B streaming feasibility harness — SECURITY MODULE (proof-only).
 *
 * Pure, dependency-free (Node built-ins only) gating, authorization, path and
 * origin validation for the disposable `/api/dev/unity-stream-proof` research
 * route. Every failure is designed to collapse into an indistinguishable 404 at
 * the route layer: these helpers return booleans / null and never explain which
 * gate failed, never echo secrets, and never echo the upstream origin.
 *
 * Disposable research infrastructure — must not be imported by gameplay,
 * presentation, realtime, shared, or any final `/unity-arena` route.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import {
  loadProofManifest,
  resolveRecordByPath,
  type ArtifactRecord,
  type ProofManifest,
} from "./manifest";

export const SUPPORTED_TRANSPORTS = ["fetch", "raw"] as const;
export type Transport = (typeof SUPPORTED_TRANSPORTS)[number];

export function isSupportedTransport(v: unknown): v is Transport {
  return v === "fetch" || v === "raw";
}

/**
 * Constant-time string comparison. Safely handles unequal lengths without
 * short-circuiting on the length check in a way that reveals it: both operands
 * are hashed to a fixed-width digest first, so `timingSafeEqual` always compares
 * equal-length buffers and the boolean length check cannot leak via timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  // Compare fixed-width SHA-256 digests so length differences never change the
  // compare cost; the explicit length check is then a pure correctness guard.
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  const digestsEqual = timingSafeEqual(da, db);
  return digestsEqual && a.length === b.length;
}

/**
 * Extract a Bearer token from an Authorization header. Requires exactly the
 * `Bearer ` scheme prefix (case-sensitive scheme per RFC is case-insensitive,
 * but we accept only the canonical form here for a proof route) and a non-empty,
 * whitespace-free token. Returns null on anything malformed.
 */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (typeof authHeader !== "string") return null;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return null;
  const token = authHeader.slice(prefix.length);
  if (token.length === 0) return null;
  if (/\s/.test(token)) return null;
  return token;
}

export interface ProofEnv {
  readonly VERCEL_ENV?: string;
  readonly UNITY_STREAM_PROOF_ENABLED?: string;
  readonly UNITY_STREAM_PROOF_BEARER?: string;
  readonly UNITY_STREAM_PROOF_ARTIFACT_ORIGIN?: string;
}

export function isProductionDenied(env: ProofEnv): boolean {
  return env.VERCEL_ENV === "production";
}

export function isProofEnabled(env: ProofEnv): boolean {
  return env.UNITY_STREAM_PROOF_ENABLED === "true";
}

export interface OriginOptions {
  /**
   * Permit `http:` — but ONLY for loopback hosts (127.0.0.0/8, localhost, ::1).
   * This is the "local test injection" escape hatch. Preview/production still
   * require `https:` because a real upstream is never loopback.
   */
  readonly allowHttp?: boolean;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.")
  );
}

/**
 * Validate and normalize UNITY_STREAM_PROOF_ARTIFACT_ORIGIN to a bare origin
 * (scheme + host [+ port]) with no trailing slash. Returns null when absent or
 * invalid. The returned value must never be logged or returned to a client.
 */
export function validateArtifactOrigin(
  raw: string | undefined | null,
  opts: OriginOptions = {},
): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const httpsOk = url.protocol === "https:";
  const httpOk =
    opts.allowHttp === true &&
    url.protocol === "http:" &&
    isLoopbackHost(url.hostname);
  if (!httpsOk && !httpOk) return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "") return null;
  if (url.hash !== "") return null;
  if (url.pathname !== "/") return null;
  return url.origin;
}

/**
 * A single route path segment is safe only if it is a non-empty string of the
 * conservative charset used by the pinned Unity artifact names. This rejects
 * `..`, `.`, backslashes, forward slashes inside a segment, colons (drive
 * letters / scheme), percent-encoding (single or repeated), null bytes, and any
 * whitespace or control character. Exact allowlist matching (below) is the real
 * gate; this is defense-in-depth.
 */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function isSafePathSegment(seg: unknown): seg is string {
  if (typeof seg !== "string") return false;
  if (seg.length === 0) return false;
  if (seg === "." || seg === "..") return false;
  return SAFE_SEGMENT_RE.test(seg);
}

/**
 * Resolve the dynamic `[...path]` segments (as delivered by Next, already
 * percent-decoded once) to exactly one allowlisted fixture record, or null.
 * Every segment must pass `isSafePathSegment`, and the joined path must match a
 * fixture record path exactly (case-sensitive). No `new URL()` is constructed
 * from user input; only the fixed origin + the fixture's own relative path are
 * ever combined (in the stream proxy).
 */
export function resolveAllowlistedRecord(
  segments: readonly unknown[],
  manifest: ProofManifest = loadProofManifest(),
): ArtifactRecord | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  for (const seg of segments) {
    if (!isSafePathSegment(seg)) return null;
  }
  const candidate = (segments as string[]).join("/");
  return resolveRecordByPath(candidate, manifest);
}

export type GateDenyReason =
  | "production"
  | "disabled"
  | "bearer_env_missing"
  | "authorization_missing_or_malformed"
  | "bearer_mismatch"
  | "origin_missing_or_invalid"
  | "transport_unknown"
  | "path_not_allowlisted";

export interface GateInput {
  readonly env: ProofEnv;
  readonly authHeader: string | null | undefined;
  readonly transport: unknown;
  readonly pathSegments: readonly unknown[];
  readonly originOptions?: OriginOptions;
}

export type GateResult =
  | { readonly ok: true; readonly transport: Transport; readonly origin: string; readonly record: ArtifactRecord }
  | { readonly ok: false; readonly reason: GateDenyReason };

/**
 * Evaluate every gate in a fixed order. The caller MUST convert any `ok: false`
 * into an identical opaque 404 regardless of `reason` (the reason is for
 * server-side aggregate diagnostics only and must never reach the client).
 * Production is denied first, before any upstream work is contemplated.
 */
export function evaluateGate(input: GateInput): GateResult {
  const { env, authHeader, transport, pathSegments } = input;

  if (isProductionDenied(env)) return { ok: false, reason: "production" };
  if (!isProofEnabled(env)) return { ok: false, reason: "disabled" };

  const bearer = env.UNITY_STREAM_PROOF_BEARER;
  if (typeof bearer !== "string" || bearer.length === 0)
    return { ok: false, reason: "bearer_env_missing" };

  const token = extractBearerToken(authHeader);
  if (token === null)
    return { ok: false, reason: "authorization_missing_or_malformed" };
  if (!constantTimeEqual(token, bearer))
    return { ok: false, reason: "bearer_mismatch" };

  const origin = validateArtifactOrigin(
    env.UNITY_STREAM_PROOF_ARTIFACT_ORIGIN,
    input.originOptions,
  );
  if (origin === null) return { ok: false, reason: "origin_missing_or_invalid" };

  if (!isSupportedTransport(transport))
    return { ok: false, reason: "transport_unknown" };

  const record = resolveAllowlistedRecord(pathSegments);
  if (record === null) return { ok: false, reason: "path_not_allowlisted" };

  return { ok: true, transport, origin, record };
}
