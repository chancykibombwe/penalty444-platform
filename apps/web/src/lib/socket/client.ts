import { io, Socket } from "socket.io-client";
import { supabase } from "../supabase/client";

let socket: Socket | null = null;

/**
 * Sprint 2 TASK 2: pass the Supabase access token in the socket handshake
 * so the realtime server can verify identity (`socket.data.userId`). The
 * server treats this as best-effort today; missing tokens are tolerated
 * to preserve gameplay for anonymous / legacy clients during rollout.
 */
async function readAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:4000", {
      transports: ["websocket", "polling"], // ✅ allow fallback
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth: (cb) => {
        void readAccessToken().then((accessToken) => {
          cb({ accessToken: accessToken ?? "" });
        });
      },
    });
  }
  return socket;
}

/** Disconnects the singleton socket if it was created. Does not open a new connection. */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
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
