import { RealtimeEventSchema, type RealtimeEvent } from '@omnidesk/contracts';
import { io } from 'socket.io-client';
import { setConnectionStatus } from './connection-status';

export interface RealtimeHandlers {
  onEvent: (event: RealtimeEvent) => void;
  /** Cada vez que el socket se conecta: hay que volver a pedir todo por si se perdió algo. */
  onResync: () => void;
}

/** Lo que `bindSocket` necesita del socket (lo cumple el `Socket` de socket.io-client). */
export interface SocketLike {
  on(event: string, listener: (...args: never[]) => void): unknown;
  connect(): unknown;
}

const RETRY_AFTER_SERVER_DISCONNECT_MS = 5_000;

/** Conecta los eventos del socket con el estado de conexión y los handlers. */
export function bindSocket(socket: SocketLike, handlers: RealtimeHandlers): void {
  let hasConnected = false;

  socket.on('connect', () => {
    hasConnected = true;
    setConnectionStatus('live');
    handlers.onResync();
  });

  socket.on('disconnect', (reason: string) => {
    setConnectionStatus('reconnecting');
    // Si el servidor cierra la conexión (p. ej. rechazo), socket.io no reintenta solo.
    if (reason === 'io server disconnect') {
      setTimeout(() => socket.connect(), RETRY_AFTER_SERVER_DISCONNECT_MS);
    }
  });

  socket.on('connect_error', () => {
    setConnectionStatus(hasConnected ? 'reconnecting' : 'connecting');
  });

  socket.on('conversation.changed', (payload: unknown) => {
    const event = RealtimeEventSchema.safeParse(payload);
    if (event.success) handlers.onEvent(event.data);
    else console.warn('Evento en tiempo real inválido', event.error);
  });
}

/** Abre el socket hacia `url` por `path` (incluye la subruta) y devuelve la función que lo cierra. */
export function connectRealtime(
  { url, path }: { url: string; path: string },
  handlers: RealtimeHandlers,
): () => void {
  setConnectionStatus('connecting');
  const socket = io(url, { path, withCredentials: true });
  bindSocket(socket, handlers);
  return () => {
    socket.close();
    setConnectionStatus('connecting');
  };
}
