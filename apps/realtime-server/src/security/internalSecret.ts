/**
 * Hardening Sprint 4 — TASK 10: shared internal-secret guard.
 *
 * Every `/internal/*` endpoint on the realtime server REQUIRES the
 * `x-realtime-internal-secret` header. The secret matches
 * `REALTIME_INTERNAL_SECRET` shared between the realtime server and the
 * web app (`apps/web/.env.local` / hosting env).
 *
 * Previously this lived as a private function inside `index.ts`. It is
 * extracted here so:
 *
 *   1. Future internal endpoints (in any module) can import the same
 *      check instead of re-implementing it.
 *   2. We can write a single audit query against this file to find every
 *      `requireInternalSecret` call site.
 *   3. A future enhancement (rotate-tolerant secret pool, IP allow-list,
 *      etc.) lands in one file.
 *
 * The helper is express-typed but only depends on `req.headers`, so it
 * also works from any framework that exposes a similar shape.
 */

import type { Request, Response } from "express";
import { realtimeInternalSecret } from "../config";

/**
 * Returns true when the request carries a valid internal secret.
 * Returns false otherwise.
 *
 * Behaviour notes:
 *   - When `realtimeInternalSecret` is empty (env missing) ALL requests
 *     are rejected. This intentionally fails closed — the secret must be
 *     set explicitly even in dev, otherwise internal endpoints are sealed.
 *   - The header is compared as plain string equality. No timing-safe
 *     compare is used because the secret is server-internal and the
 *     attacker model here is "external host without the secret", not
 *     "side-channel adversary".
 */
export function isAuthorizedInternalRequest(req: Request): boolean {
  if (!realtimeInternalSecret) return false;

  const headerSecret = req.headers["x-realtime-internal-secret"];
  if (typeof headerSecret !== "string" || headerSecret.length === 0) {
    return false;
  }
  return headerSecret === realtimeInternalSecret;
}

/**
 * Express-style guard. Returns true and lets the caller continue when
 * the secret matches. On mismatch it sends `401 Unauthorized` and
 * returns false.
 *
 * Usage:
 *
 *   app.post("/internal/foo", (req, res) => {
 *     if (!requireInternalSecret(req, res)) return;
 *     // ... handler ...
 *   });
 */
export function requireInternalSecret(
  req: Request,
  res: Response
): boolean {
  if (isAuthorizedInternalRequest(req)) return true;
  res.status(401).json({ error: "Unauthorized." });
  console.warn(
    `[Security] internal endpoint blocked path=${req.path} method=${req.method}`
  );
  return false;
}
