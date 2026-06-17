/**
 * Hardening Sprint 4 — TASK 2: consolidated socket identity helpers.
 *
 * This module is the single import surface every sensitive handler should
 * use when answering "is this socket allowed to perform action X as
 * playerId Y in room Z?".
 *
 * Existing helpers (`resolvePlayerForSocket`, `assertSocketOwnsPlayer`)
 * live in `./identity` and continue to do the heavy lifting for the
 * room-bound checks. This module adds:
 *
 *   - `getSocketUserId`             — typed getter for `socket.data.userId`.
 *   - `requireAuthenticatedSocket`  — strict JWT ruling, used in enforce mode.
 *   - `assertSocketCanActInRoom`    — combined ladder used by handlers.
 *   - `rejectUnauthorizedSocketAction` — emit `error:message` + log + bail.
 *
 * Every rejection follows the same logging contract:
 *   `[Security] <action> rejected reason=<reason> socketId=<id> ...`
 *
 * Spectator sockets (members of `room.spectatorSocketIds`) are ALWAYS
 * rejected by these helpers — they may never act as players.
 */

import type { Socket } from "socket.io";
import type { Room } from "../types/room";
import { jwtEnforcementEnabled } from "./jwt";
import { resolvePlayerForSocket, type IdentityCheckResult } from "./identity";

export {
  resolvePlayerForSocket,
  assertSocketOwnsPlayer,
  type IdentityCheckResult,
  type IdentityRejectReason,
} from "./identity";

/**
 * Pure getter — returns the verified Supabase user id stamped on the
 * socket by `verifySocketJwt`, or `null` when no JWT was provided / the
 * verification failed.
 */
export function getSocketUserId(socket: Socket): string | null {
  return socket.data.userId ?? null;
}

export type AuthenticatedSocketResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_authenticated"; authError: string };

/**
 * Strict authentication gate. When `SOCKET_JWT_ENFORCE=true` an
 * unauthenticated socket cannot act on behalf of any player. Returns
 * a discriminated union so the caller can `if (!result.ok) return;`.
 *
 * In non-enforce mode this is a no-op (returns ok with userId === claimed
 * value or empty string), preserving the legacy free-play flow.
 */
export function requireAuthenticatedSocket(
  socket: Socket,
  action: string
): AuthenticatedSocketResult {
  if (!jwtEnforcementEnabled()) {
    // Soft mode: return ok regardless. Caller logs the absence so we can
    // observe how many handlers run without a JWT in production before
    // flipping the flag.
    return { ok: true, userId: socket.data.userId ?? "" };
  }

  if (!socket.data.authenticated || !socket.data.userId) {
    const authError = socket.data.authError ?? "not_verified";
    console.warn(
      `[Security] unauthenticated action blocked action=${action} ` +
        `socketId=${socket.id} authError=${authError}`
    );
    return { ok: false, reason: "not_authenticated", authError };
  }

  return { ok: true, userId: socket.data.userId };
}

export type PlayerMatchResult =
  | { ok: true }
  | { ok: false; reason: "jwt_player_mismatch" | "not_authenticated" };

/**
 * Verify that a client-provided player ID is consistent with the
 * socket's verified JWT identity.
 *
 * The rule:
 *   - Verified JWT present + matches claimed ID  → ok, silent.
 *   - Verified JWT present + mismatches claimed ID → rejected, ALWAYS
 *     (regardless of SOCKET_JWT_ENFORCE). A token proving a different
 *     identity overrides any client-supplied claim.
 *   - No verified JWT + SOCKET_JWT_ENFORCE=true → rejected.
 *   - No verified JWT + soft mode → allowed (legacy free-play / dev path).
 */
export function assertSocketUserMatchesPlayer(
  socket: Socket,
  claimedPlayerId: string,
  action: string
): PlayerMatchResult {
  const verifiedUserId = socket.data.userId ?? null;

  if (verifiedUserId) {
    if (verifiedUserId !== claimedPlayerId) {
      console.warn(
        `[Security] ${action} jwt_player_mismatch socketId=${socket.id} ` +
          `claimed=${claimedPlayerId} verified=${verifiedUserId}`
      );
      return { ok: false, reason: "jwt_player_mismatch" };
    }
    return { ok: true };
  }

  if (jwtEnforcementEnabled()) {
    console.warn(
      `[Security] ${action} not_authenticated socketId=${socket.id} ` +
        `claimed=${claimedPlayerId}`
    );
    return { ok: false, reason: "not_authenticated" };
  }

  return { ok: true };
}

export type SocketActionRejectReason =
  | "not_authenticated"
  | "missing_player_id"
  | "spectator_socket"
  | "player_not_in_room"
  | "socket_player_mismatch"
  | "tournament_not_allowed"
  | "jwt_player_mismatch";

export type SocketActionResult =
  | { ok: true; userId: string; player: NonNullable<IdentityCheckResult & { ok: true }>["player"] }
  | { ok: false; reason: SocketActionRejectReason };

/**
 * Combined identity check for sensitive handlers. Equivalent to:
 *
 *   1. requireAuthenticatedSocket(socket, action)        // soft unless enforce-mode
 *   2. resolvePlayerForSocket(room, socket, playerId, action)
 *
 * but with a single return type so handlers stay terse:
 *
 *   const check = assertSocketCanActInRoom(socket, room, playerId, "match:pick");
 *   if (!check.ok) return;
 *
 * All rejections are logged inside the underlying helpers; the caller
 * doesn't need to log again.
 */
export function assertSocketCanActInRoom(
  socket: Socket,
  room: Room,
  rawPlayerId: unknown,
  action: string
): SocketActionResult {
  const auth = requireAuthenticatedSocket(socket, action);
  if (!auth.ok) {
    return { ok: false, reason: "not_authenticated" };
  }

  const identity = resolvePlayerForSocket(room, socket, rawPlayerId, action);
  if (identity.ok === false) {
    return { ok: false, reason: identity.reason };
  }

  return { ok: true, userId: auth.userId, player: identity.player };
}

/**
 * Convenience emit + log for handlers that want to surface a
 * user-visible rejection (e.g. `match:abortEarly`, `publicOffer:join`).
 *
 * Most sensitive handlers should bail SILENTLY (no error event) to avoid
 * leaking action validity to attackers. Use this only when the user
 * already expects feedback (e.g. button click → toast).
 */
export function rejectUnauthorizedSocketAction(
  socket: Socket,
  action: string,
  reason: SocketActionRejectReason | string,
  context: { roomCode?: string; playerId?: string } = {}
): void {
  console.warn(
    `[Security] unauthorized action rejected action=${action} reason=${reason} ` +
      `socketId=${socket.id} roomCode=${context.roomCode ?? "—"} ` +
      `playerId=${context.playerId ?? "—"}`
  );
  socket.emit("error:message", {
    message: "You are not authorised to perform this action.",
  });
}
