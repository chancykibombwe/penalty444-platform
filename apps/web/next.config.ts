import type { NextConfig } from "next";

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
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const headers = isProd ? PRODUCTION_HEADERS : COMMON_HEADERS;
    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;
