"use client";

/**
 * Sprint 6 — TASK 1+2+3+7: authenticated Socket.IO client.
 *
 * Single source of truth for the realtime socket. The whole web app
 * routes through `getSocket()` (or its authenticated cousin), so any
 * change to the auth payload landing here propagates everywhere.
 *
 * Design contract:
 *
 *   1. ONE Socket.IO client per browser session. Every component that
 *      asks for the socket gets the same instance back.
 *
 *   2. Auth payload is set with the dynamic-callback form:
 *        auth: (cb) => readAccessToken().then(token => cb({ accessToken: token ?? "" }))
 *      socket.io re-invokes this callback on every connect / reconnect,
 *      so the realtime server always sees the FRESHEST Supabase access
 *      token attached to every handshake.
 *
 *   3. We bind exactly ONE `supabase.auth.onAuthStateChange` listener
 *      per browser tab. On:
 *        - `SIGNED_OUT`     → disconnect the socket (downgrade).
 *        - `SIGNED_IN`      → reconnect to pick up the new token via
 *                             the dynamic auth callback.
 *        - `TOKEN_REFRESHED`→ reconnect (cheap; same dynamic callback).
 *
 *   4. NEVER print the access / refresh token. Diagnostics use a tiny
 *      `[socket-auth]` prefix in development only and only log
 *      presence / state — never values.
 *
 *   5. The server (`apps/realtime-server`) is the authority. The
 *      client may include `playerId` in event payloads for
 *      compatibility, but the server cross-checks it against
 *      `socket.data.userId` (the verified Supabase user id) and rejects
 *      mismatches when `SOCKET_JWT_ENFORCE=true`. This file does NOT
 *      try to enforce identity client-side.
 */

import { io, type Socket } from "socket.io-client";
import { supabase } from "../supabase/client";

let socket: Socket | null = null;
let authListenerBound = false;
let lastAttachedUserId: string | null = null;
let suppressNextDisconnectLog = false;

const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:4000";

const isDev = process.env.NODE_ENV !== "production";

function devLog(message: string, extra?: Record<string, unknown>) {
  if (!isDev) return;
  if (extra) {
    console.log(`[socket-auth] ${message}`, extra);
  } else {
    console.log(`[socket-auth] ${message}`);
  }
}

/**
 * Return the current Supabase access token, or null when no session
 * exists. Errors swallow to null so a transient supabase failure never
 * crashes the socket connect path.
 */
async function readAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Bind the auth state listener on first call. The listener:
 *   - SIGNED_OUT  → disconnect the live socket. Components that still
 *                   need it can call `getSocket()` again to reopen
 *                   anonymously.
 *   - SIGNED_IN / TOKEN_REFRESHED → reconnect so the dynamic auth
 *                   callback re-runs with the new token.
 */
function bindAuthListenerOnce(): void {
  if (authListenerBound) return;
  authListenerBound = true;

  supabase.auth.onAuthStateChange((event, session) => {
    const newUserId = session?.user?.id ?? null;

    if (event === "SIGNED_OUT") {
      devLog("signed out, socket downgraded");
      lastAttachedUserId = null;
      if (socket && socket.connected) {
        // Suppress the disconnect log that fires immediately after; the
        // SIGNED_OUT log above is enough.
        suppressNextDisconnectLog = true;
        socket.disconnect();
      }
      return;
    }

    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      devLog(
        event === "SIGNED_IN" ? "signed in, refreshing socket auth" : "token refreshed",
        {
          sameUser: lastAttachedUserId === newUserId,
          wasConnected: socket?.connected ?? false,
        }
      );

      lastAttachedUserId = newUserId;

      if (!socket) {
        // Socket hasn't been created yet — first `getSocket()` call
        // will pick up the fresh token via the dynamic callback.
        return;
      }

      if (socket.connected) {
        // disconnect → connect re-runs the auth callback. socket.io's
        // chained API supports `.disconnect().connect()` for this.
        socket.disconnect().connect();
      } else {
        // Already disconnected (e.g. after SIGNED_OUT) — only reconnect
        // when there's a session, otherwise stay quiet.
        if (newUserId) {
          socket.connect();
        }
      }
    }
  });
}

/**
 * Lazy singleton accessor. Creates the socket on first call with the
 * dynamic auth callback wired in. Always binds the auth listener so
 * the same socket survives every sign-in / sign-out cycle.
 */
export function getSocket(): Socket {
  bindAuthListenerOnce();

  if (!socket) {
    socket = io(REALTIME_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth: (cb) => {
        void readAccessToken()
          .then((accessToken) => {
            // We attach an EMPTY string when no session exists; the
            // realtime server treats this as `no_token`. Both forms
            // produce the same server-side reason.
            devLog(accessToken ? "token attached" : "anonymous (no token)");
            cb({ accessToken: accessToken ?? "" });
          })
          .catch(() => {
            cb({ accessToken: "" });
          });
      },
    });

    if (isDev) {
      socket.on("connect", () => {
        devLog(`connected socketId=${socket?.id ?? "—"}`);
      });
      socket.on("disconnect", (reason) => {
        if (suppressNextDisconnectLog) {
          suppressNextDisconnectLog = false;
          return;
        }
        devLog(`disconnected reason=${reason}`);
      });
      socket.on("connect_error", (err) => {
        devLog(`connect_error message=${err?.message ?? "—"}`);
      });
    }
  }

  return socket;
}

export type AuthenticatedSocketResult = {
  socket: Socket;
  authenticated: boolean;
  userId: string | null;
};

/**
 * Returns the singleton socket along with the current Supabase session
 * snapshot. Useful when a caller wants to short-circuit before
 * emitting a sensitive event:
 *
 *   const { authenticated } = await getAuthenticatedSocket();
 *   if (!authenticated) return;
 *
 * Note: this does NOT block until the socket is connected — it only
 * reports the auth side. socket.io's dynamic auth callback already
 * makes "the next emit waits for connect" the default behaviour.
 */
export async function getAuthenticatedSocket(): Promise<AuthenticatedSocketResult> {
  bindAuthListenerOnce();
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data?.session?.user?.id ?? null;
  } catch {
    userId = null;
  }
  return {
    socket: getSocket(),
    authenticated: userId !== null,
    userId,
  };
}

/**
 * Force the socket to drop and re-establish its connection so the
 * dynamic `auth` callback re-runs with the freshest Supabase token.
 *
 * In normal operation the auth-state-change listener calls this for
 * you on `SIGNED_IN` / `TOKEN_REFRESHED`. Callers should only need to
 * invoke this from a manual sign-in flow that bypasses the standard
 * Supabase auth events (rare).
 */
export function reconnectSocketWithAuth(): void {
  if (!socket) {
    // No socket yet — first getSocket() call will read the fresh token.
    devLog("auth refresh — socket not yet created, deferring");
    return;
  }
  if (socket.connected) {
    devLog("reconnecting with refreshed auth");
    socket.disconnect().connect();
  } else {
    devLog("auth refresh — reconnecting from disconnected state");
    socket.connect();
  }
}

/** Alias kept for sign-in flows that read more naturally. */
export const refreshSocketAuth = reconnectSocketWithAuth;

/**
 * Disconnects the singleton socket if it was created. Does not open a
 * new connection. The next `getSocket()` call will reopen anonymously
 * unless the auth-state-change listener has SIGNED_OUT'd in the
 * meantime.
 */
export function disconnectSocket(): void {
  if (socket) {
    suppressNextDisconnectLog = true;
    socket.disconnect();
    devLog("disconnected (manual)");
  }
}

export type RoomScopedSocketPayload = {
  roomCode?: string;
  code?: string;
};

/**
 * Returns true when the event targets the given room.
 * Legacy payloads without roomCode are accepted (single-room sessions).
 */
export function isSocketEventForRoom(
  payload: RoomScopedSocketPayload | undefined,
  roomCode: string
): boolean {
  if (!payload) {
    return false;
  }

  const packetRoom = (payload.roomCode ?? payload.code)?.trim().toUpperCase();
  const expected = roomCode.trim().toUpperCase();

  if (!packetRoom) {
    return true;
  }

  return packetRoom === expected;
}
