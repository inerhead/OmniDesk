import { useSyncExternalStore } from 'react';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  live: 'En vivo',
  reconnecting: 'Reconectando…',
  connecting: 'Conectando…',
};

/** Cada cuánto se refresca la bandeja mientras el socket no está conectado. */
export const BACKUP_POLLING_INTERVAL_MS = 15_000;

let status: ConnectionStatus = 'connecting';
const listeners = new Set<() => void>();

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

export function setConnectionStatus(next: ConnectionStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of listeners) listener();
}

export function subscribeConnectionStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribeConnectionStatus, getConnectionStatus, () => 'connecting');
}

/** Con el socket conectado no hay polling; si no, un respaldo cada 15 s. */
export function backupPollingInterval(current: ConnectionStatus): number | false {
  return current === 'live' ? false : BACKUP_POLLING_INTERVAL_MS;
}
