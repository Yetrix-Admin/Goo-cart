import { io, Socket } from "socket.io-client";
import { API_URL } from "@/config/environment";

// One shared connection for the whole app. Auth is passed in the handshake
// (see server/src/lib/realtime.ts) rather than as a query string, so it
// never ends up logged in a URL. The token is refreshed by calling connect()
// again after sign-in/out — see useAuthStore.
let socket: Socket | null = null;

export function getSocket(token: string | null): Socket | null {
  if (!API_URL) return null;

  if (socket && socket.auth && (socket.auth as any).token === token) return socket;

  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (!token) return null;

  socket = io(API_URL, {
    auth: { token },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
