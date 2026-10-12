import { useSyncExternalStore } from 'react';

/** Hasta el spec de identidad, la web elige con qué miembro actúa y lo envía en `X-Demo-Member-Id`. */
export const ACTOR_STORAGE_KEY = 'omnidesk:demo-member-id';

function read(): string | null {
  try {
    return localStorage.getItem(ACTOR_STORAGE_KEY);
  } catch {
    return null; // modo privado o almacenamiento bloqueado
  }
}

let actorId: string | null = read();
const listeners = new Set<() => void>();

export function getActorId(): string | null {
  return actorId;
}

export function setActorId(next: string): void {
  if (next === actorId) return;
  actorId = next;
  try {
    localStorage.setItem(ACTOR_STORAGE_KEY, next);
  } catch {
    // La elección vale para esta sesión aunque no se pueda guardar.
  }
  for (const listener of listeners) listener();
}

export function subscribeActorId(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStoredActorId(): string | null {
  return useSyncExternalStore(subscribeActorId, getActorId, () => null);
}
