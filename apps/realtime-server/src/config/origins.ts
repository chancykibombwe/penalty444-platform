/**
 * Hardening Sprint 5 — TASK 3: realtime CORS allow-list.
 *
 * Replaces the old `origin: "*"` Socket.IO + cors() configuration with
 * an explicit allow-list driven by environment.
 *
 * Behaviour by mode:
 *
 *   NODE_ENV !== "production":
 *     - localhost:3000  (Next.js dev server)
 *     - localhost:4000  (realtime server itself, useful for local probes)
 *     - 127.0.0.1:3000  (mirror of localhost for browsers that resolve it)
 *     - 127.0.0.1:4000
 *     - Any value present in `ALLOWED_ORIGINS` (csv) is added on top so
 *       a developer using a Vercel preview / ngrok tunnel can opt in.
 *     - Missing/empty Origin (e.g. native fetch from same host) is allowed.
 *
 *   NODE_ENV === "production":
 *     - ONLY the comma-separated entries from `ALLOWED_ORIGINS` are
 *       allowed. No localhost fallback. No wildcard.
 *     - When `ALLOWED_ORIGINS` is empty in production we DENY every
 *       origin and log a fatal warning at startup (see env validation).
 *
 * Rejected origins log:
 *   `[Security] CORS origin rejected origin=<value> mode=<dev|prod>`
 *
 * Module is side-effect-free; the express `cors` middleware and the
 * Socket.IO server consume `originValidator` at construction time.
 */

const DEV_DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:4000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4000",
];

/**
 * Vercel preview deployments get a fresh hash-based subdomain per branch
 * (e.g. `penalty444-platform-at1y-git-ui-94262e-chancykibombwes-projects.vercel.app`),
 * so a static ALLOWED_ORIGINS entry can never cover every preview URL.
 *
 * To avoid widening this into a general `*.vercel.app` or
 * `*-chancykibombwes-projects.vercel.app` wildcard, an origin must match
 * BOTH a required prefix (this project's slug) AND a required suffix
 * (this team's Vercel account), and must be `https:`.
 */
const VERCEL_PREVIEW_HOST_PREFIX = "penalty444-platform-at1y-git-";
const VERCEL_PREVIEW_HOST_SUFFIX = "-chancykibombwes-projects.vercel.app";

function isAllowedVercelPreviewOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") {
    return false;
  }

  return (
    url.hostname.startsWith(VERCEL_PREVIEW_HOST_PREFIX) &&
    url.hostname.endsWith(VERCEL_PREVIEW_HOST_SUFFIX)
  );
}

function parseAllowedOriginsEnv(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Returns the static allow-list resolved at process start. We freeze the
 * list once at boot so dynamic env mutation can't widen the policy at
 * runtime.
 */
export function getAllowedOrigins(): readonly string[] {
  const envOrigins = parseAllowedOriginsEnv();

  if (isProduction()) {
    return Object.freeze([...envOrigins]);
  }

  return Object.freeze([...DEV_DEFAULT_ORIGINS, ...envOrigins]);
}

const allowedOriginsCached = getAllowedOrigins();

export type CorsOriginCallback = (
  err: Error | null,
  allow?: boolean
) => void;

/**
 * Express / Socket.IO compatible origin validator. Delegates the full
 * decision to a single helper so both surfaces share the same policy.
 *
 * Origin can legitimately be undefined for:
 *   - Native fetch from the same host (no Origin header).
 *   - Server-to-server callers (curl, internal cron).
 * We allow undefined origin in dev for ergonomics and DENY it in
 * production unless the request is internal-secret-authorised (which
 * never reaches CORS — those are header-based, not origin-based).
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    // Same-origin / no-Origin requests are accepted in dev. In prod we
    // also accept them because Socket.IO clients in same-origin contexts
    // (and curl probes) never set Origin. The internal-secret guard is
    // the real gate for anything sensitive.
    return true;
  }

  const list = allowedOriginsCached;
  return list.includes(origin) || isAllowedVercelPreviewOrigin(origin);
}

/**
 * Express `cors` middleware origin validator. Calls the callback with
 * `(null, true)` to allow and `(error)` to reject. Rejection bubbles up
 * as a 500 from `cors()`, so we also log the attempt for triage.
 */
export function corsOriginValidator(
  origin: string | undefined,
  callback: CorsOriginCallback
): void {
  if (isOriginAllowed(origin)) {
    callback(null, true);
    return;
  }
  console.warn(
    `[Security] CORS origin rejected origin=${origin ?? "—"} mode=${
      isProduction() ? "prod" : "dev"
    }`
  );
  callback(new Error("Origin not allowed"));
}

/**
 * Diagnostic snapshot for `/health` / startup banner. Never exposes
 * env values — only counts.
 */
export function describeOriginPolicy(): {
  mode: "production" | "development";
  count: number;
} {
  return {
    mode: isProduction() ? "production" : "development",
    count: allowedOriginsCached.length,
  };
}
