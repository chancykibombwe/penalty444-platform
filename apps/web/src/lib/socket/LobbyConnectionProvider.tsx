"use client";

/**
 * Lobby socket bootstrap.
 *
 * Background
 * ----------
 * The lobby has multiple panels (Public Offers, Ranked, Quick Play,
 * Create/Join Room) that all need the same realtime connection. This
 * provider:
 *
 *   1. Awaits `supabase.auth.getSession()` BEFORE the first
 *      `getSocket()` call so the dynamic auth callback in
 *      `lib/socket/client.ts` reads the correct access token on the
 *      first handshake. That removed an early "first-connect / TOKEN
 *      REFRESHED" race in an earlier hotfix.
 *
 *   2. Owns the canonical `connect` / `disconnect` / reconnect
 *      lifecycle listeners on behalf of every lobby panel. Children
 *      consume the derived state via `useLobbyConnection()` and never
 *      need to attach their own `connect` / `disconnect` listeners
 *      again. This is what makes panels stay in sync even if one of
 *      them unmounts during a refresh.
 *
 *   3. Emits a defense-in-depth `publicOffers:request` whenever the
 *      socket reconnects after a drop. The realtime server already
 *      pushes a connection-snapshot, but a redundant client request
 *      means we never hold a stale lobby because a single packet was
 *      missed. Tagged `[lobby:sync]` for production audit.
 *
 *   4. Mirrors all reconnect lifecycle events under
 *      `[socket:reconnect]` so we can observe storms / cascades in
 *      production logs without any token leakage.
 *
 * What this file does NOT change
 * ------------------------------
 *   - The socket singleton in `lib/socket/client.ts` (still the
 *     authoritative reconnect pipeline).
 *   - Any gameplay / match-page socket flows (they have their own
 *     room-scoped listeners that this provider does not touch).
 *   - The JWT / token attachment path.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../supabase/client";
import { getSocket } from "./client";

export type LobbyConnectionState = {
  /** True while the socket reports a healthy connection. */
  connected: boolean;
  /**
   * True once the bootstrap has finished awaiting the Supabase session
   * and attached its `connect` / `disconnect` listeners. Panels can use
   * this to suppress the "Disconnected" badge during the brief first
   * mount window before the socket has had a chance to handshake.
   */
  ready: boolean;
  /**
   * True between a `disconnect` and the next successful `connect` (or
   * reconnect-failed terminal state). Lets the UI show "Reconnecting…"
   * instead of bare "Disconnected".
   */
  reconnecting: boolean;
  /**
   * Last observed reconnect-attempt number from the socket.io manager.
   * `0` means no reconnect has been attempted (or the last cycle
   * succeeded and was reset). Mostly useful for diagnostics, but
   * panels MAY display "Reconnecting… attempt N" if desired.
   */
  reconnectAttempt: number;
};

const LobbyConnectionContext = createContext<LobbyConnectionState>({
  connected: false,
  ready: false,
  reconnecting: false,
  reconnectAttempt: 0,
});

export function LobbyConnectionProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // We need to skip the very first `connect` (initial handshake) when
  // deciding whether to fire a [lobby:sync] re-request — the server
  // already pushes the snapshot on initial connect.
  const hasConnectedOnceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    async function bootstrap() {
      // Resolve the Supabase session first. The result is intentionally
      // discarded — we only need the side-effect of forcing any
      // pending TOKEN_REFRESHED to fire (and be consumed by the
      // singleton's auth listener) before we open the first socket.
      try {
        await supabase.auth.getSession();
      } catch {
        // Transient Supabase failures should not block lobby bootstrap.
        // The dynamic auth callback inside getSocket() falls back to an
        // empty token on its own.
      }

      if (cancelled) return;

      const socket = getSocket();
      const manager = socket.io;

      function onConnect() {
        console.log("[lobby:sync] socket connected", {
          socketId: socket.id ?? null,
          firstConnect: !hasConnectedOnceRef.current,
        });
        setConnected(true);
        setReconnecting(false);
        setReconnectAttempt(0);

        if (hasConnectedOnceRef.current) {
          // Reconnect after a drop — explicitly re-request the lobby
          // snapshot for defense-in-depth. The server also pushes one
          // automatically on connect, but a duplicate emit costs us
          // nothing and guarantees the panel state cannot diverge
          // because of a single missed packet.
          console.log("[lobby:sync] requesting public offers snapshot");
          socket.emit("publicOffers:request");
        }

        hasConnectedOnceRef.current = true;
      }

      function onDisconnect(reason: string) {
        console.log("[lobby:sync] socket disconnected", { reason });
        setConnected(false);
        // socket.io's reconnect machinery picks up immediately on most
        // disconnect reasons. Flag `reconnecting` so the UI can show a
        // softer state than bare "Disconnected".
        // Exception: an explicit `io client disconnect` means we asked
        // for the disconnect (e.g. SIGNED_OUT) — no reconnect coming.
        if (reason !== "io client disconnect") {
          setReconnecting(true);
        }
      }

      function onReconnectAttempt(attempt: number) {
        console.log("[socket:reconnect] lobby_attempt", { attempt });
        setReconnecting(true);
        setReconnectAttempt(attempt);
      }

      function onReconnect(attempt: number) {
        // Fires AFTER the underlying `connect` event when reconnect
        // succeeds. We log here to keep reconnect counters tidy; the
        // `connect` handler above is what actually triggers the
        // [lobby:sync] re-request.
        console.log("[socket:reconnect] lobby_succeeded", { attempt });
      }

      function onReconnectError(err: Error) {
        console.log("[socket:reconnect] lobby_error", {
          message: err?.message ?? null,
        });
      }

      function onReconnectFailed() {
        // With reconnectionAttempts=Infinity on the singleton this
        // should never fire. If it does, surface it.
        console.log("[socket:reconnect] lobby_failed_giving_up");
        setReconnecting(false);
      }

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      manager.on("reconnect_attempt", onReconnectAttempt);
      manager.on("reconnect", onReconnect);
      manager.on("reconnect_error", onReconnectError);
      manager.on("reconnect_failed", onReconnectFailed);

      // If the socket is already healthy (e.g. survived navigation from
      // /match back to /lobby), reflect that immediately.
      if (socket.connected) {
        setConnected(true);
        hasConnectedOnceRef.current = true;
      } else if (!socket.active) {
        // socket.active is false when the client is fully idle (not
        // already attempting). Triggering connect here gives us a
        // single authoritative entry point — panels do not call
        // socket.connect() from their own useEffects anymore.
        socket.connect();
      }

      setReady(true);

      detach = () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        manager.off("reconnect_attempt", onReconnectAttempt);
        manager.off("reconnect", onReconnect);
        manager.off("reconnect_error", onReconnectError);
        manager.off("reconnect_failed", onReconnectFailed);
      };
    }

    void bootstrap();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  return (
    <LobbyConnectionContext.Provider
      value={{ connected, ready, reconnecting, reconnectAttempt }}
    >
      {children}
    </LobbyConnectionContext.Provider>
  );
}

export function useLobbyConnection(): LobbyConnectionState {
  return useContext(LobbyConnectionContext);
}
