import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webAppRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Hardening Sprint 5 — TASK 5: production security headers.
 *
 * The header set is intentionally CONSERVATIVE so it cannot break
 * Supabase Auth, Realtime websockets, or local development:
 *
 *   - X-Frame-Options: DENY              (no clickjacking)
 *   - X-Content-Type-Options: nosniff    (no MIME confusion)
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy: deny camera/mic/geolocation/payment by default
 *   - Strict-Transport-Security: enabled in production HTTPS only
 *
 * Content-Security-Policy is INTENTIONALLY OMITTED for now. CSP for a
 * Next.js 16 + Supabase + Socket.IO app needs careful per-route nonce
 * work to avoid breaking React Server Components, hot reload, and the
 * Supabase auth iframe. The rollout plan lives in
 * `docs/security/runtime-security.md` § CSP rollout.
 *
 * If you add a custom header here, also document it in that file and
 * test in `next dev`, `next build && next start`, and on Vercel preview
 * before merging.
 */

const COMMON_HEADERS = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=()",
  },
];

const PRODUCTION_HEADERS = [
  ...COMMON_HEADERS,
  {
    // Two-year HSTS with subdomains. Only effective over HTTPS; harmless
    // on localhost (browsers ignore HSTS over plain HTTP).
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/**
 * B6C — versioned STAGING artifact delivery (docs/unity-b6c-versioned-staging-delivery.md).
 *
 * `UNITY_STAGING_ARTIFACT_ORIGIN` is a SERVER-ONLY variable (never NEXT_PUBLIC_)
 * naming an immutable Vercel PREVIEW deployment of a locally-built, verified B6B
 * WebGL release — e.g. `https://penalty444-unity-staging-abc123.vercel.app`.
 *
 * When it is absent, NO staging rewrite is added and local/production behavior is
 * unchanged (CI and `next dev` build normally). When it is set, it is strictly
 * validated so the rewrite can never become an open proxy: the destination
 * hostname is fixed to this validated origin and can never be chosen by a request.
 * A non-empty but invalid value FAILS the build with a clear error.
 *
 * Returns the normalized origin (no trailing slash) or `null` when unconfigured.
 */
function resolveStagingArtifactOrigin(): string | null {
  const raw = process.env.UNITY_STAGING_ARTIFACT_ORIGIN;
  if (raw === undefined || raw.trim() === "") return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `UNITY_STAGING_ARTIFACT_ORIGIN is not a valid URL: ${JSON.stringify(raw)}`,
    );
  }

  const problems: string[] = [];
  if (url.protocol !== "https:") problems.push("protocol must be https:");
  if (url.username !== "" || url.password !== "")
    problems.push("must not contain credentials");
  if (url.search !== "") problems.push("must not contain a query string");
  if (url.hash !== "") problems.push("must not contain a fragment");
  if (url.pathname !== "/") problems.push("pathname must be '/'");
  if (!url.hostname.endsWith(".vercel.app"))
    problems.push("hostname must end with .vercel.app");

  if (problems.length > 0) {
    throw new Error(
      `UNITY_STAGING_ARTIFACT_ORIGIN is invalid (${problems.join("; ")}): ${JSON.stringify(raw)}`,
    );
  }

  // Normalize to scheme + host, no trailing slash.
  return url.origin;
}

// Staging header blocks are inert unless the staging route is actually reachable
// (they only match /unity/penalty444/staging/**). They never weaken the global
// headers and never touch the existing local /unity/penalty444/ prototype paths.
const STAGING_HEADER_RULES = [
  {
    source:
      "/unity/penalty444/staging/releases/:version/Build/:path*.framework.js.gz",
    headers: [
      { key: "Content-Type", value: "application/javascript" },
      { key: "Content-Encoding", value: "gzip" },
    ],
  },
  {
    source: "/unity/penalty444/staging/releases/:version/Build/:path*.wasm.gz",
    headers: [
      { key: "Content-Type", value: "application/wasm" },
      { key: "Content-Encoding", value: "gzip" },
    ],
  },
  {
    source: "/unity/penalty444/staging/releases/:version/Build/:path*.data.gz",
    headers: [
      { key: "Content-Type", value: "application/octet-stream" },
      { key: "Content-Encoding", value: "gzip" },
    ],
  },
  {
    source: "/unity/penalty444/staging/releases/:version/:path*",
    headers: [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
      {
        key: "CDN-Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
      { key: "x-vercel-enable-rewrite-caching", value: "1" },
    ],
  },
];

const nextConfig: NextConfig = {
  // Monorepo has lockfiles at repo root and apps/web — pin Turbopack to
  // this app so `next dev` does not infer the wrong workspace root.
  turbopack: {
    root: webAppRoot,
  },
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const headers = isProd ? PRODUCTION_HEADERS : COMMON_HEADERS;
    return [
      {
        source: "/:path*",
        headers,
      },
      // ── Dev-only Unity WebGL build serving ───────────────────────────────
      // Scoped strictly to /unity/penalty444/ (the git-ignored, local-only
      // WebGL build; see docs/unity-webgl-build-pipeline.md). These rules are
      // inert everywhere else and never weaken the global headers above. Two
      // fixes, both required for the browser to run the build:
      //   1. Unity ships pre-compressed .gz artifacts. Serve each with its real
      //      Content-Type + `Content-Encoding: gzip` so the browser decompresses
      //      and executes/parses it. (The global `nosniff` stays on — declaring
      //      the correct type is exactly what satisfies it.)
      //   2. Relax ONLY `X-Frame-Options` from DENY → SAMEORIGIN for this
      //      subpath so the same-origin dev viewer (/dev/unity/penalty444) can
      //      iframe /unity/penalty444/index.html. Per Next.js header precedence
      //      ("the last header key will override the first"), this override wins
      //      over the global DENY for these paths only; framing stays same-origin.
      {
        source: "/unity/penalty444/Build/:path*.framework.js.gz",
        headers: [
          { key: "Content-Type", value: "application/javascript" },
          { key: "Content-Encoding", value: "gzip" },
        ],
      },
      {
        source: "/unity/penalty444/Build/:path*.wasm.gz",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Content-Encoding", value: "gzip" },
        ],
      },
      {
        source: "/unity/penalty444/Build/:path*.data.gz",
        headers: [
          { key: "Content-Type", value: "application/octet-stream" },
          { key: "Content-Encoding", value: "gzip" },
        ],
      },
      {
        source: "/unity/penalty444/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      // ── B6C staging artifact headers (see STAGING_HEADER_RULES) ──────────
      // Scoped strictly to /unity/penalty444/staging/**. Correct WebGL MIME +
      // gzip for the proxied gz payloads, and same-origin framing + immutable
      // cache for the versioned release path. Inert unless the staging rewrite
      // is configured and reached.
      ...STAGING_HEADER_RULES,
    ];
  },
  // ── B6C server-only external rewrite ──────────────────────────────────────
  // Only added when UNITY_STAGING_ARTIFACT_ORIGIN is configured and valid. The
  // browser-visible URL stays same-origin (/unity/penalty444/staging/...), which
  // preserves the existing same-origin postMessage checks; the destination host
  // is the fixed validated origin and can NOT be chosen by the request, so this
  // is not an open proxy. When unconfigured, no rewrite exists.
  async rewrites() {
    const origin = resolveStagingArtifactOrigin();
    if (!origin) return [];
    return [
      {
        source: "/unity/penalty444/staging/:path*",
        destination: `${origin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
