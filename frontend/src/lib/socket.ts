// Socket.io connections, one per namespace, all authenticated with the access
// token in the handshake (the backend's ws-auth middleware rejects otherwise).
import { io, Socket } from 'socket.io-client';

const URL = import.meta.env.VITE_SOCKET_URL as string;

export type Namespace = 'world' | 'chat' | 'roulette' | 'blackjack' | 'lobby';

const sockets = new Map<Namespace, Socket>();

export function connect(ns: Namespace, token: string): Socket {
  const existing = sockets.get(ns);
  if (existing) {
    existing.auth = { token };
    if (!existing.connected) existing.connect();
    return existing;
  }
  const socket = io(`${URL}/${ns}`, {
    auth: { token },
    transports: ['websocket'],
    autoConnect: true,
  });
  sockets.set(ns, socket);
  return socket;
}

export function get(ns: Namespace): Socket | undefined {
  return sockets.get(ns);
}

export function disconnectAll() {
  for (const s of sockets.values()) s.disconnect();
  sockets.clear();
}
