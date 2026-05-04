import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:4000", {
      transports: ["websocket", "polling"], // ✅ allow fallback
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
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