import { useSyncExternalStore } from 'react';

/**
 * Aviso de mensaje nuevo de un cliente en el icono de Conversaciones (SPEC 21). Vive en memoria, por
 * pestaña del navegador: recargar lo borra.
 */
export type NewMessageSignal =
  | { kind: 'idle' }
  /** Fuera de /conversations: bucle (o punto fijo) hasta entrar. */
  | { kind: 'pending' }
  /** Dentro de /conversations: una pasada; `seq` cambia con cada mensaje y reinicia la animación. */
  | { kind: 'pulse'; seq: number };

const IDLE: NewMessageSignal = { kind: 'idle' };

let signal: NewMessageSignal = IDLE;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: NewMessageSignal): void {
  signal = next;
  for (const listener of listeners) listener();
}

/** `/conversations` y cualquier ruta bajo ella. */
export function isConversationsPath(pathname: string): boolean {
  return pathname === '/conversations' || pathname.startsWith('/conversations/');
}

/** Llegó un mensaje de un cliente. */
export function signalInbound(onConversations: boolean): void {
  if (onConversations) {
    seq += 1;
    set({ kind: 'pulse', seq });
  } else if (signal.kind !== 'pending') {
    set({ kind: 'pending' });
  }
}

/** El usuario entró a /conversations: el icono vuelve a reposo. */
export function clearSignal(): void {
  if (signal.kind !== 'idle') set(IDLE);
}

export function getNewMessageSignal(): NewMessageSignal {
  return signal;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNewMessageSignal(): NewMessageSignal {
  return useSyncExternalStore(subscribe, getNewMessageSignal, () => IDLE);
}
