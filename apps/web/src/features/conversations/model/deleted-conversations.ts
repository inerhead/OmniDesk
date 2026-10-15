import { useSyncExternalStore } from 'react';

/**
 * Conversaciones borradas mientras la app está abierta (evento `deleted`, SPEC 12): el chat abierto
 * avisa de que se eliminó en lugar de quedarse con el historial en pantalla. Vive en memoria.
 */
const deleted = new Set<string>();
const listeners = new Set<() => void>();

export function markConversationDeleted(conversationId: string): void {
  if (deleted.has(conversationId)) return;
  deleted.add(conversationId);
  for (const listener of listeners) listener();
}

export function isConversationDeleted(conversationId: string): boolean {
  return deleted.has(conversationId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConversationDeleted(conversationId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deleted.has(conversationId),
    () => false,
  );
}
