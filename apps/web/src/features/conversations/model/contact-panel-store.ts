import { useSyncExternalStore } from 'react';

/** Si la columna del panel de contacto (≥ xl) está abierta. Por dispositivo. */
export const CONTACT_PANEL_STORAGE_KEY = 'omnidesk:contact-panel';

function read(): boolean {
  try {
    return localStorage.getItem(CONTACT_PANEL_STORAGE_KEY) !== 'closed';
  } catch {
    return true; // visible por defecto, aunque no se pueda leer
  }
}

let open: boolean | null = null;
const listeners = new Set<() => void>();

function getOpen(): boolean {
  open ??= read();
  return open;
}

export function setContactPanelOpen(next: boolean): void {
  if (next === getOpen()) return;
  open = next;
  try {
    localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, next ? 'open' : 'closed');
  } catch {
    // Vale para esta sesión aunque no se pueda guardar.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useContactPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, getOpen, () => true);
}
