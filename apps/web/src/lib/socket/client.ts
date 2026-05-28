"use client";

/**
 * Realtime socket — single authoritative client.
 *
 * Design contract
 * ---------------
 *   1. ONE Socket.IO client per browser session. Every component that
 *      asks for the socket via `getSocket()` shares the same instance.
 *
 *   2. Auth payload is the dynamic-callback form:
 *        auth: (cb) => readAccessToken().then(token => cb({ accessToken }))
 *      socket.io re-invokes this callback on every connect / reconnect,
 *      so the realtime server always sees the freshest Supabase access
 *      token on the handshake.
 *
 *   3. Exactly ONE `supabase.auth.onAuthStateChange` listener per tab.
 *      It is intentionally *narrow*:
 *        - `SIGNED_OUT`        → tear the socket down (downgrade).
 *        - `SIGNED_IN`         → bounce only if the user identity changed
 *                                (e.g. account switch). The dynamic
 *                                callback already picks up the new token
 *                                on the next handshake — we do NOT bounce
 *                                a healthy connection just because
 *                                Supabase re-emitted SIGNED_IN.
 *        - `TOKEN_REFRESHED`   → DO NOT bounce a connected socket. The
 *                                JWT on the existing socket only matters
 *                                during the handshake (verifying
 *                                `socket.data.userId`). Once verified,
 *                                the server keeps that identity for the
 *                                lifetime of the connection. Bouncing on
 *                                every silent refresh produced the
 *                                "Realtime: Disconnected" flash users
 *                                reported.
 *
 *   4. NEVER print the access / refresh token. Diagnostics use
 *      `[socket-auth]` (dev only) for token presence, and
 *      `[socket:lifecycle]` / `[socket:reconnect]` (prod-visible) for
 *      connection events. No token values, ever.
 *
 *   5. The realtime server is the authority. The client may include
 *      `playerId` in event payloads for compatibility, but the server
 *      cross-checks it against `socket.data.userId` (the verified
 *      Supabase user id) and rejects mismatches when
 *      `SOCKET_JWT_ENFORCE=true`. This file does NOT try to enforce
 *      identity client-side.
 *
 * Reconnect policy
 * ----------------
 *   - websocket-first, polling fallback (for restrictive networks).
 *   - `reconnectionAttempts: Infinity` — never give up silently.
 *   - Exponential backoff `500ms → 5s` with jitter so a thundering-herd
 *     reconnect after a transient backend hiccup does not stack.
 *   - `timeout: 20000` — handshake budget for slow first connects.
 *
 * All reconnect lifecycle events log under `[socket:reconnect]` so we
 * can audit reconnect storms in production.
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

function lifecycleLog(message: string, extra?: Record<string, unknown>) {
  // Production-visible. No tokens, no user payloads — only state names
  // and reasons. Used by ops to audit reconnect storms.
  if (extra) {
    console.log(`[socket:lifecycle] ${message}`, extra);
  } else {
    console.log(`[socket:lifecycle] ${message}`);
  }
}

function reconnectLog(message: string, extra?: Record<string, unknown>) {
  if (extra) {
    console.log(`[socket:reconnect] ${message}`, extra);
  } else {
    console.log(`[socket:reconnect] ${message}`);
  }
}

/**
 * Return the current Supabase access token, or null when no session
 * exists. Errors swallow to null so a transient Supabase failure never
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
 * Bind the auth state listener exactly once. Behaviour matches the
 * docstring policy at the top of this file.
 */
function bindAuthListenerOnce(): void {
  if (authListenerBound) return;
  authListenerBound = true;

  supabase.auth.onAuthStateChange((event, session) => {
    const newUserId = session?.user?.id ?? null;

    if (event === "SIGNED_OUT") {
      devLog("signed out, socket downgraded");
      lifecycleLog("auth_signed_out", { hadSocket: Boolean(socket) });
      lastAttachedUserId = null;
      if (socket && socket.connected) {
        // Suppress the disconnect log that fires immediately after; the
        // SIGNED_OUT log above is enough.
        suppressNextDisconnectLog = true;
        socket.disconnect();
      }
      return;
    }

    if (event === "SIGNED_IN") {
      const previousUserId = lastAttachedUserId;
      const userChanged =
        previousUserId !== null && newUserId !== null && previousUserId !== newUserId;
      lastAttachedUserId = newUserId;

      devLog("signed in", {
        sameUser: previousUserId === newUserId,
        wasConnected: socket?.connected ?? false,
        userChanged,
      });
      lifecycleLog("auth_signed_in", {
        userChanged,
        hadSocket: Boolean(socket),
        wasConnected: socket?.connected ?? false,
      });

      if (!socket) {
        // First getSocket() call will pick up the fresh token via the
        // dynamic callback. Nothing to do.
        return;
      }

      // Only bounce when the IDENTITY actually changed. A SIGNED_IN
      // re-emit for the same user on a healthy socket would otherwise
      // tear the connection down for no reason.
      if (userChanged) {
        if (socket.connected) {
          socket.disconnect().connect();
        } else {
          socket.connect();
        }
        return;
      }

      // Same user → make sure we're connected, but never bounce a
      // healthy connection.
      if (!socket.connected && newUserId) {
        socket.connect();
      }
      return;
    }

    if (event === "TOKEN_REFRESHED") {
      devLog("token refreshed", {
        sameUser: lastAttachedUserId === newUserId,
        wasConnected: socket?.connected ?? false,
      });
      lifecycleLog("auth_token_refreshed", {
        wasConnected: socket?.connected ?? false,
      });

      lastAttachedUserId = newUserId;

      if (!socket) {
        return;
      }

      // The verified `socket.data.userId` was set at handshake time and
      // does NOT need a fresh token to stay valid. Skip the bounce on
      // healthy sockets — this was the main source of "Realtime:
      // Disconnected" flashes that drove this whole audit.
      if (socket.connected) {
        return;
      }

      // If we're already disconnected and there is a session, let the
      // existing socket.io reconnect loop pick up the new token via the
      // dynamic auth callback. Only nudge it if reconnection has been
      // halted (`active === false`).
      if (newUserId && !socket.active) {
        socket.connect();
      }
      return;
    }
  });
}

/**
 * Lazy singleton accessor. Creates the socket on first call with the
 * dynamic auth callback wired in.
 */
export function getSocket(): Socket {
  bindAuthListenerOnce();

  if (!socket) {
    socket = io(REALTIME_URL, {
      transports: ["websocket", "polling"],
      // websocket first; allow upgrade so we never get stuck on polling
      // after a degraded first handshake.
      upgrade: true,
      reconnection: true,
      // Never give up silently. socket.io's reconnect loop is the
      // authoritative reconnect pipeline — panels should not race it
      // with their own socket.connect() calls.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.4,
      timeout: 20000,
      auth: (cb) => {
        void readAccessToken()
          .then((accessToken) => {
            // Empty string when no session exists; the realtime server
            // treats this as `no_token`. Both forms produce the same
            // server-side reason.
            devLog(accessToken ? "token attached" : "anonymous (no token)");
            cb({ accessToken: accessToken ?? "" });
          })
          .catch(() => {
            cb({ accessToken: "" });
          });
      },
    });

    // Production-visible lifecycle diagnostics. No tokens, no payload
    // contents — only event names, reasons, and counters.
    socket.on("connect", () => {
      lifecycleLog("connect", {
        socketId: socket?.id ?? null,
        transport: socket?.io?.engine?.transport?.name ?? null,
      });
      if (isDev) devLog(`connected socketId=${socket?.id ?? "—"}`);
    });

    socket.on("disconnect", (reason) => {
      if (suppressNextDisconnectLog) {
        suppressNextDisconnectLog = false;
        return;
      }
      lifecycleLog("disconnect", { reason });
      if (isDev) devLog(`disconnected reason=${reason}`);
    });

    socket.on("connect_error", (err) => {
      lifecycleLog("connect_error", { message: err?.message ?? null });
      if (isDev) devLog(`connect_error message=${err?.message ?? "—"}`);
    });

    // Reconnect lifecycle. socket.io exposes these on the `Manager`
    // (socket.io); attaching here gives us a single audit trail.
    const manager = socket.io;
    manager.on("reconnect_attempt", (attempt) => {
      reconnectLog("attempt", { attempt });
    });
    manager.on("reconnect", (attempt) => {
      reconnectLog("succeeded", { attempt });
    });
    manager.on("reconnect_error", (err) => {
      reconnectLog("error", { message: err?.message ?? null });
    });
    manager.on("reconnect_failed", () => {
      // With `reconnectionAttempts: Infinity` this should never fire.
      // If it ever does, surface it loudly so we know the policy was
      // overridden somewhere.
      reconnectLog("failed_giving_up");
    });
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
 * In normal operation the auth-state-change listener handles this for
 * you. Callers should only need to invoke this from a manual sign-in
 * flow that bypasses Supabase auth events (rare).
 */
export function reconnectSocketWithAuth(): void {
  if (!socket) {
    devLog("auth refresh — socket not yet created, deferring");
    return;
  }
  if (socket.connected) {
    devLog("reconnecting with refreshed auth");
    lifecycleLog("manual_reconnect_with_auth");
    socket.disconnect().connect();
  } else {
    devLog("auth refresh — reconnecting from disconnected state");
    lifecycleLog("manual_reconnect_from_disconnected");
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
    lifecycleLog("manual_disconnect");
  }
}

/**
 * Attach an event listener and return a cleanup function. Encourages
 * the symmetric attach/detach pattern across panels and prevents
 * stranded listeners when components forget the matching `socket.off`.
 *
 * Usage:
 *
 *   useEffect(() => onSocket(socket, "publicOffers:update", onUpdate), [...])
 *
 * The returned function is idempotent — safe to call from a React
 * cleanup that may run twice in strict mode.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function onSocket<T extends (...args: any[]) => void>(
  s: Socket,
  event: string,
  handler: T
): () => void {
  s.on(event, handler);
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    s.off(event, handler);
  };
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
