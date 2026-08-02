/**
 * B6D3B PR-1 — cohort configuration, gating and opaque denial (server-only, pure).
 *
 * Reads ONLY server-side variables (never `NEXT_PUBLIC_*`) and never returns,
 * logs, or echoes any of them:
 *
 *   - `VERCEL_ENV`                    — production is hard-denied first, always.
 *   - `UNITY_COHORT_EMAILS`           — server-only allowlist.
 *   - `UNITY_COHORT_SIGNING_SECRET`   — capability HMAC secret.
 *   - `UNITY_COHORT_TOKEN_VERSION`    — integer; bump = instant global revocation.
 *   - `UNITY_COHORT_ARTIFACT_ORIGIN`  — fixed bare HTTPS upstream origin.
 *
 * Every gate failure must be collapsed by the caller into ONE indistinguishable
 * 404 (`opaqueNotFound()`), so the existence of the feature is never confirmed.
 * This module never emits 401/403.
 *
 * This module is server-only and must never be imported by a client component.
 */

export interface CohortEnv {
  readonly VERCEL_ENV?: string;
  readonly UNITY_COHORT_EMAILS?: string;
  readonly UNITY_COHORT_SIGNING_SECRET?: string;
  readonly UNITY_COHORT_TOKEN_VERSION?: string;
  readonly UNITY_COHORT_ARTIFACT_ORIGIN?: string;
}

/** Read the server-only cohort environment. Values are never logged or returned. */
export function readCohortEnv(): CohortEnv {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    UNITY_COHORT_EMAILS: process.env.UNITY_COHORT_EMAILS,
    UNITY_COHORT_SIGNING_SECRET: process.env.UNITY_COHORT_SIGNING_SECRET,
    UNITY_COHORT_TOKEN_VERSION: process.env.UNITY_COHORT_TOKEN_VERSION,
    UNITY_COHORT_ARTIFACT_ORIGIN: process.env.UNITY_COHORT_ARTIFACT_ORIGIN,
  };
}

/**
 * Production is denied for session mint, player entry and artifact delivery.
 * This must be evaluated BEFORE any Supabase lookup, origin resolution, token
 * signing, or upstream request.
 */
export function isProductionDenied(env: CohortEnv): boolean {
  return env.VERCEL_ENV === "production";
}

// ── Allowlist ─────────────────────────────────────────────────────────────────

/**
 * Parse `UNITY_COHORT_EMAILS`: comma-separated, trimmed, lower-cased, empties
 * removed. Mirrors the audited `ADMIN_EMAILS` pattern. The list itself never
 * crosses the network.
 */
export function parseCohortEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** Membership test against the parsed allowlist. An empty list denies everyone. */
export function isEmailInCohort(email: unknown, allowlist: readonly string[]): boolean {
  if (typeof email !== "string" || email.length === 0) return false;
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

// ── Signing secret / token version ────────────────────────────────────────────

/** Return the signing secret only when it is present and strong enough. */
export function resolveSigningSecret(env: CohortEnv): string | null {
  const secret = env.UNITY_COHORT_SIGNING_SECRET;
  if (typeof secret !== "string" || secret.length < 32) return null; // fail closed
  return secret;
}

/**
 * Parse the required token version. Must be an explicit non-negative integer —
 * absent, blank, fractional, negative or non-numeric FAILS CLOSED (null), so a
 * misconfiguration can never silently accept version 0.
 */
export function resolveTokenVersion(env: CohortEnv): number | null {
  const raw = env.UNITY_COHORT_TOKEN_VERSION;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

// ── Artifact origin ───────────────────────────────────────────────────────────

/** Vercel host suffix for the dedicated artifact project. */
const VERCEL_HOST_SUFFIX = ".vercel.app";
/**
 * Name of the DEDICATED artifact project (already documented in
 * docs/unity-b6c-versioned-staging-delivery.md). Its bare form is the project /
 * production alias and is REJECTED; a per-deployment hostname is this name plus a
 * `-` and a generated deployment suffix. The generated suffix itself is never
 * hardcoded here.
 */
const ARTIFACT_PROJECT_LABEL = "penalty444-unity-staging";
const ARTIFACT_DEPLOYMENT_PREFIX = `${ARTIFACT_PROJECT_LABEL}-`;

/**
 * Validate `UNITY_COHORT_ARTIFACT_ORIGIN` into a BARE origin (scheme + host [+
 * port], no trailing path). Returns null when absent or invalid. The value is
 * fixed by server configuration, is NEVER request-controlled, and must never be
 * exposed in a header, HTML body, response, or diagnostic.
 *
 * Rules enforced here:
 *   - `https:` only;
 *   - no username/password, no query, no fragment, pathname exactly `/`;
 *   - single-label `*.vercel.app` hostname (no nested subdomain);
 *   - the exact project/production alias `penalty444-unity-staging.vercel.app` is
 *     REJECTED;
 *   - the hostname must begin with `penalty444-unity-staging-` and carry a
 *     non-empty deployment suffix after that prefix;
 *   - any unrelated Vercel project is REJECTED.
 *
 * **Scope of this check (important, do not overstate).** This validates only that
 * the configured URL *belongs to the dedicated artifact project* and is *not* that
 * project's known alias. It does **not** independently prove Vercel deployment
 * target metadata: it cannot show that the deployment is immutable, `READY`, or
 * `target=null`. A hostname shape is not deployment state. The later
 * protected-preview gate must still verify — through Vercel deployment metadata —
 * that the configured deployment is immutable, `READY` and `target=null`.
 *
 * An earlier revision used a generic "any hyphenated label is an immutable
 * preview" heuristic. That claim was FALSE for this project, because the project
 * alias `penalty444-unity-staging.vercel.app` also contains hyphens and would have
 * been accepted. The generic rule has been removed.
 */
export function validateArtifactOrigin(raw: string | undefined | null): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "") return null;
  if (url.hash !== "") return null;
  if (url.pathname !== "/") return null;

  const host = url.hostname.toLowerCase();
  if (!host.endsWith(VERCEL_HOST_SUFFIX)) return null;
  const label = host.slice(0, host.length - VERCEL_HOST_SUFFIX.length);
  if (label.length === 0) return null;
  if (label.includes(".")) return null; // single label only — no nested subdomain

  // Explicitly reject the project / production alias.
  if (label === ARTIFACT_PROJECT_LABEL) return null;
  // Must be a deployment hostname of the dedicated artifact project…
  if (!label.startsWith(ARTIFACT_DEPLOYMENT_PREFIX)) return null;
  // …with a non-empty generated deployment suffix.
  if (label.length <= ARTIFACT_DEPLOYMENT_PREFIX.length) return null;

  return url.origin;
}

// ── Bearer extraction ─────────────────────────────────────────────────────────

/**
 * Extract a canonical `Bearer <token>` value. Requires the exact `Bearer ` prefix
 * and a non-empty, whitespace-free token. Returns null on anything malformed.
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

// ── Opaque denial ─────────────────────────────────────────────────────────────

/**
 * The single denial response for EVERY failed gate (production, missing config,
 * bad bearer, non-member, missing/invalid/expired/revoked cookie, bad path).
 * Byte-identical in all cases; never cacheable; reveals nothing.
 */
export function opaqueNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Sanitized upstream-failure response (authorized request, upstream problem). */
export function sanitizedUpstreamFailure(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
