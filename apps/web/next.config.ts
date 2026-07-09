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
    ];
  },
};

export default nextConfig;
