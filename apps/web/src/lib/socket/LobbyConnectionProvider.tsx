"use client";

/**
 * Lobby socket bootstrap.
 *
 * Background
 * ----------
 * On a fresh `/lobby` load the Ranked + Public Offers panels each held
 * their own `connected` flag, and at least one of them (Ranked) never
 * triggered `socket.connect()` on mount. Because `getSocket()` uses the
 * socket.io default `autoConnect: true` with a *dynamic* Supabase auth
 * callback, the very first connect could race with a `TOKEN_REFRESHED`
 * fired by `onAuthStateChange` (see `lib/socket/client.ts`), which then
 * tears the connection down with `socket.disconnect().connect()`. Both
 * panels saw the intermediate `disconnect`, flipped their local
 * `connected` flag to false, and at least one of them missed the final
 * `connect` event — leaving the lobby UI stuck on "Realtime:
 * Disconnected" until the user clicked **Refresh Lobby**.
 *
 * Design
 * ------
 *   1. Wait for `supabase.auth.getSession()` to resolve BEFORE calling
 *      `getSocket()` for the first time. The dynamic auth callback then
 *      reads the right access token on the first connect and the
 *      `TOKEN_REFRESHED` reconnect storm doesn't fire on mount.
 *   2. Own a single `connect` / `disconnect` listener pair on behalf of
 *      every lobby panel. Children consume the resulting `connected`
 *      flag via `useLobbyConnection()`.
 *   3. Do NOT change the socket singleton, the Supabase auth listener,
 *      or any gameplay/tournament logic. Match-page sockets are
 *      unaffected — they keep their own room-scoped listeners.
 *   4. Do NOT relax JWT / token attachment. The dynamic auth callback
 *      in `client.ts` is untouched; we just give it a stable starting
 *      point.
 */

import {
  createContext,
  useContext,
  useEffect,
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
};

const LobbyConnectionContext = createContext<LobbyConnectionState>({
  connected: false,
  ready: false,
});

export function LobbyConnectionProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);

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

      function onConnect() {
        setConnected(true);
      }

      function onDisconnect() {
        setConnected(false);
      }

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);

      // If the socket is already healthy (e.g. survived navigation from
      // /match back to /lobby), reflect that immediately.
      if (socket.connected) {
        setConnected(true);
      } else if (!socket.active) {
        // socket.active is false when the client is fully idle (not
        // already attempting). Triggering connect here gives us a single
        // authoritative entry point — panels no longer need to call
        // socket.connect() from their own useEffects.
        socket.connect();
      }

      setReady(true);

      detach = () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
      };
    }

    void bootstrap();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  return (
    <LobbyConnectionContext.Provider value={{ connected, ready }}>
      {children}
    </LobbyConnectionContext.Provider>
  );
}

export function useLobbyConnection(): LobbyConnectionState {
  return useContext(LobbyConnectionContext);
}
