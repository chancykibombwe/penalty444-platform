/**
 * Hardening Sprint 2 — TASK 2: lightweight Supabase JWT verification.
 *
 * Today the realtime server trusts the `playerId` payload on every event
 * and only validates it against the room roster via `resolvePlayerForSocket`.
 * That is good enough to stop *casual* spoofing but a malicious client
 * who steals a roommate's socketId+playerId could still impersonate them.
 *
 * This module adds a NON-BREAKING upgrade path:
 *
 *   - Client passes its Supabase access token in `socket.handshake.auth.accessToken`.
 *   - On connect we asynchronously verify the token with the service-role
 *     Supabase client. On success we set `socket.data.userId`.
 *   - Sensitive handlers can soft-check `socket.data.userId` against the
 *     incoming `playerId`. A mismatch is logged with `[Security]` prefix
 *     but does NOT currently reject the request — that's gated until the
 *     web client is updated to always send the token.
 *
 * Once the web client always sends an access token (tracked in
 * docs/socket-auth-plan.md → "Phase 2 — enforcement"), we flip the flag
 * `JWT_ENFORCE` and missing/invalid tokens become hard rejects.
 *
 * The module is intentionally tolerant of misconfiguration: if `supabase`
 * is null (no service role env vars in dev), JWT verification is a no-op
 * and the connection still works exactly like Sprint 1.
 */

import type { Socket } from "socket.io";
import { supabase } from "../config";

const JWT_ENFORCE = process.env.SOCKET_JWT_ENFORCE === "true";

declare module "socket.io" {
  interface SocketData {
    userId: string | null;
    jwtVerifiedAt: number | null;
    /**
     * Sprint 4 TASK 3: stable boolean snapshot of the JWT verification
     * result. Handlers should prefer `requireAuthenticatedSocket` over
     * reading this directly because it also resolves the
     * pending-verification race during connection handshake.
     */
    authenticated: boolean;
    /**
     * Sprint 4 TASK 3: machine-readable failure reason when
     * `authenticated === false`. Mirrors the `reason` from
     * `JwtVerificationResult`. Useful for ops dashboards and
     * `[Security]` logs.
     */
    authError: JwtAuthError | null;
    /**
     * Sprint 4 TASK 3: in-flight verification promise. Async handlers
     * that need a fresh ruling can `await socket.data.authPromise`
     * before consulting `authenticated`. Set on connect.
     */
    authPromise: Promise<JwtVerificationResult> | null;
  }
}

export type JwtAuthError =
  | "no_token"
  | "invalid_token"
  | "no_backend"
  | "not_verified";

export type JwtVerificationResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "no_token" | "invalid_token" | "no_backend" };

/**
 * Read the access token off the handshake. Supports both `auth.accessToken`
 * (preferred) and the legacy `auth.token` field for resilience during the
 * client migration.
 */
function extractAccessToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as
    | { accessToken?: unknown; token?: unknown }
    | undefined;
  const raw = auth?.accessToken ?? auth?.token;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Verify the socket's access token (if any) and stamp `socket.data.userId`.
 * Returns a result so callers can decide whether to log / disconnect.
 *
 * Safe to call from any code path; failures are isolated.
 */
export async function verifySocketJwt(
  socket: Socket
): Promise<JwtVerificationResult> {
  socket.data.userId = socket.data.userId ?? null;
  socket.data.jwtVerifiedAt = socket.data.jwtVerifiedAt ?? null;
  // Initialise the Sprint 4 fields on every verify call so every code
  // path sees a defined value.
  socket.data.authenticated = socket.data.authenticated ?? false;
  socket.data.authError = socket.data.authError ?? "not_verified";

  const token = extractAccessToken(socket);
  if (!token) {
    socket.data.authenticated = false;
    socket.data.authError = "no_token";
    return { ok: false, reason: "no_token" };
  }
  if (!supabase) {
    socket.data.authenticated = false;
    socket.data.authError = "no_backend";
    return { ok: false, reason: "no_backend" };
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      socket.data.authenticated = false;
      socket.data.authError = "invalid_token";
      return { ok: false, reason: "invalid_token" };
    }
    socket.data.userId = data.user.id;
    socket.data.jwtVerifiedAt = Date.now();
    socket.data.authenticated = true;
    socket.data.authError = null;
    return { ok: true, userId: data.user.id };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[Security] jwt verify crashed:", err);
    }
    socket.data.authenticated = false;
    socket.data.authError = "invalid_token";
    return { ok: false, reason: "invalid_token" };
  }
}

/**
 * Sprint 4 TASK 3: capture the verification handle on `socket.data` so
 * async handlers can await freshness. `verifySocketJwt` already mutates
 * `socket.data.authenticated` / `authError` synchronously before returning.
 */
export function bindSocketJwtVerification(socket: Socket): Promise<JwtVerificationResult> {
  const promise = verifySocketJwt(socket);
  socket.data.authPromise = promise;
  return promise;
}

/**
 * Soft check that the verified userId (if any) matches the playerId the
 * client claims. Returns true when:
 *   - JWT verification has not yet been performed, OR
 *   - the JWT was missing/invalid (in non-enforce mode), OR
 *   - the verified userId equals the claimed playerId.
 *
 * Returns false on a mismatch when we have a valid JWT. The caller decides
 * how strict to be; in enforce mode they should reject.
 */
export function jwtMatchesPlayer(
  socket: Socket,
  claimedPlayerId: string
): boolean {
  const verifiedUserId = socket.data.userId;
  if (!verifiedUserId) return true;
  return verifiedUserId === claimedPlayerId;
}

export function jwtEnforcementEnabled(): boolean {
  return JWT_ENFORCE;
}
