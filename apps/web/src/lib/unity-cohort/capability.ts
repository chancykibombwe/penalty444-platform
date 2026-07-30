/**
 * B6D3B PR-1 — cohort capability token + session cookie (server-only, pure).
 *
 * Signs and verifies the short-lived capability that authorizes the protected
 * `/unity-arena/**` surface. Node `crypto` only — no new dependency.
 *
 * Security contract:
 *   - HMAC-SHA-256 over a strict Base64URL payload; constant-time comparison.
 *   - Payload is EXACTLY `{ sub, iat, exp, ver }` — no email, no service data.
 *     `sub` is the stable Supabase user id.
 *   - Maximum TTL 600 s (10 minutes); expiry always enforced.
 *   - `ver` must equal the configured `UNITY_COHORT_TOKEN_VERSION`, so a version
 *     bump (or secret rotation) invalidates every outstanding cookie immediately.
 *   - A missing or weak signing secret FAILS CLOSED (returns null; never signs).
 *   - Nothing here logs a token, a payload, a secret, or an identity.
 *
 * The token travels ONLY in the `p444_unity_cohort` HttpOnly Secure cookie — never
 * in a URL, query string, response body, or browser-readable storage.
 *
 * This module is server-only: it must never be imported by a client component.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COHORT_COOKIE_NAME = "p444_unity_cohort";
/** One cookie path covers both `/unity-arena/player` and `/unity-arena/artifact/**`. */
export const COHORT_COOKIE_PATH = "/unity-arena";
/** Hard maximum capability lifetime (seconds). */
export const MAX_CAPABILITY_TTL_SECONDS = 600;
/** Minimum accepted signing-secret length; shorter fails closed. */
export const MIN_SIGNING_SECRET_LENGTH = 32;

/** Exact capability payload. No additional field is ever accepted or emitted. */
export interface CapabilityPayload {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly ver: number;
}

const PAYLOAD_KEYS = ["exp", "iat", "sub", "ver"] as const;

// ── Base64URL (strict) ────────────────────────────────────────────────────────

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Strict Base64URL decode. Rejects standard-Base64 alphabet (`+`, `/`), padding,
 * whitespace, and any non-canonical encoding (re-encoding must round-trip).
 */
function base64UrlDecode(value: string): Buffer | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!BASE64URL_RE.test(value)) return null;
  try {
    const buf = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (buf.length === 0) return null;
    // Canonical-form check: a tampered/ambiguous encoding will not round-trip.
    if (base64UrlEncode(buf) !== value) return null;
    return buf;
  } catch {
    return null;
  }
}

// ── Constant-time comparison ──────────────────────────────────────────────────

/**
 * Constant-time string comparison. Both operands are hashed to a fixed-width
 * digest first, so `timingSafeEqual` always compares equal-length buffers and a
 * length difference cannot leak through the comparison cost.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isSafeNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** A signing secret is usable only when present and long enough. */
export function isUsableSigningSecret(secret: unknown): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SIGNING_SECRET_LENGTH;
}

function signPayloadSegment(payloadSegment: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(payloadSegment, "utf8").digest());
}

/** Strictly validate a decoded payload object into a CapabilityPayload, or null. */
function validatePayloadShape(value: unknown): CapabilityPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (keys.length !== PAYLOAD_KEYS.length) return null;
  for (let i = 0; i < PAYLOAD_KEYS.length; i++) {
    if (keys[i] !== PAYLOAD_KEYS[i]) return null; // no missing and no extra field
  }
  const rec = value as Record<string, unknown>;
  const { sub, iat, exp, ver } = rec;
  if (!isNonEmptyString(sub)) return null;
  if (!isSafeNonNegativeInt(iat)) return null;
  if (!isSafeNonNegativeInt(exp)) return null;
  if (!isSafeNonNegativeInt(ver)) return null;
  if (exp <= iat) return null;
  if (exp - iat > MAX_CAPABILITY_TTL_SECONDS) return null; // TTL ceiling
  return { sub, iat, exp, ver };
}

// ── Sign ──────────────────────────────────────────────────────────────────────

export interface SignCapabilityInput {
  readonly sub: string;
  /** Current time in whole seconds. */
  readonly nowSeconds: number;
  readonly ttlSeconds: number;
  readonly ver: number;
  readonly secret: string;
}

export interface SignedCapability {
  readonly token: string;
  readonly payload: CapabilityPayload;
}

/**
 * Sign a capability. Returns null (never throws, never signs) when the secret is
 * missing/weak, the TTL is out of range, or any field is malformed.
 */
export function signCapability(input: SignCapabilityInput): SignedCapability | null {
  try {
    const { sub, nowSeconds, ttlSeconds, ver, secret } = input;
    if (!isUsableSigningSecret(secret)) return null; // fail closed
    if (!isNonEmptyString(sub)) return null;
    if (!isSafeNonNegativeInt(nowSeconds)) return null;
    if (!isSafeNonNegativeInt(ver)) return null;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) return null;
    if (ttlSeconds > MAX_CAPABILITY_TTL_SECONDS) return null; // ceiling enforced

    const payload: CapabilityPayload = {
      sub,
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
      ver,
    };
    // Fixed key order so the signed bytes are deterministic.
    const json = JSON.stringify({
      sub: payload.sub,
      iat: payload.iat,
      exp: payload.exp,
      ver: payload.ver,
    });
    const payloadSegment = base64UrlEncode(Buffer.from(json, "utf8"));
    const token = `${payloadSegment}.${signPayloadSegment(payloadSegment, secret)}`;
    return { token, payload };
  } catch {
    return null;
  }
}

// ── Verify ────────────────────────────────────────────────────────────────────

export interface VerifyCapabilityOptions {
  readonly secret: string;
  /** Required token version; a mismatch is rejected. */
  readonly ver: number;
  /** Current time in whole seconds. */
  readonly nowSeconds: number;
}

/**
 * Verify a capability token. Returns the validated payload or null. Never throws
 * and never distinguishes failure reasons to the caller (the caller must collapse
 * every failure into one opaque 404).
 */
export function verifyCapability(
  token: unknown,
  opts: VerifyCapabilityOptions,
): CapabilityPayload | null {
  try {
    if (!isUsableSigningSecret(opts.secret)) return null; // fail closed
    if (!isSafeNonNegativeInt(opts.ver)) return null;
    if (!isSafeNonNegativeInt(opts.nowSeconds)) return null;
    if (!isNonEmptyString(token)) return null;

    const dot = token.indexOf(".");
    if (dot <= 0 || dot !== token.lastIndexOf(".")) return null; // exactly one "."
    const payloadSegment = token.slice(0, dot);
    const signatureSegment = token.slice(dot + 1);
    if (!BASE64URL_RE.test(payloadSegment)) return null;
    if (!BASE64URL_RE.test(signatureSegment)) return null;

    // Signature first — never parse an unauthenticated payload's semantics.
    const expected = signPayloadSegment(payloadSegment, opts.secret);
    if (!constantTimeEqual(signatureSegment, expected)) return null;

    const decoded = base64UrlDecode(payloadSegment);
    if (decoded === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded.toString("utf8"));
    } catch {
      return null;
    }
    const payload = validatePayloadShape(parsed);
    if (payload === null) return null;

    if (payload.ver !== opts.ver) return null; // version bump ⇒ instant revocation
    if (payload.exp <= opts.nowSeconds) return null; // expiry always enforced
    if (payload.iat > opts.nowSeconds) return null; // not-yet-valid / clock skew abuse
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie ────────────────────────────────────────────────────────────────────

/**
 * Build the `Set-Cookie` value for a signed capability. `Max-Age` is aligned to the
 * token `exp` and hard-capped at `MAX_CAPABILITY_TTL_SECONDS`. Host-only: no
 * `Domain` attribute is ever emitted.
 */
export function buildCohortCookie(
  token: string,
  payload: CapabilityPayload,
  nowSeconds: number,
): string | null {
  if (!isNonEmptyString(token)) return null;
  if (!isSafeNonNegativeInt(nowSeconds)) return null;
  const remaining = payload.exp - nowSeconds;
  if (remaining <= 0) return null;
  const maxAge = Math.min(remaining, MAX_CAPABILITY_TTL_SECONDS);
  return [
    `${COHORT_COOKIE_NAME}=${token}`,
    `Path=${COHORT_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/** Build the `Set-Cookie` value that clears the capability cookie (same Path). */
export function buildClearedCohortCookie(): string {
  return [
    `${COHORT_COOKIE_NAME}=`,
    `Path=${COHORT_COOKIE_PATH}`,
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * Read a single cookie value from a raw `Cookie` header. Returns null when absent.
 * Never throws. Only the exact requested name is returned.
 */
export function readCookieValue(cookieHeader: unknown, name: string): string | null {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    return value.length > 0 ? value : null;
  }
  return null;
}
