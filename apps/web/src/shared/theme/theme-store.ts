import { useSyncExternalStore } from 'react';

/** Preferencia por dispositivo; no se sincroniza entre dispositivos. */
export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

/** Misma clave que lee el script inline de `index.html` antes del primer render. */
export const THEME_STORAGE_KEY = 'omnidesk:theme';

/** Color de la barra del navegador y de la PWA según el tema efectivo (igual que `--background`). */
export const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#0e1016' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

export function parseThemePref(value: string | null): ThemePref {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function read(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system'; // modo privado o almacenamiento bloqueado
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

let pref: ThemePref = typeof window === 'undefined' ? 'system' : read();
const listeners = new Set<() => void>();

/** Aplica la clase `.dark` en `<html>` y actualiza `<meta name="theme-color">`. */
function apply(): void {
  const theme = resolveTheme(pref, systemPrefersDark());
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function getThemePref(): ThemePref {
  return pref;
}

export function setThemePref(next: ThemePref): void {
  if (next === pref) return;
  pref = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // La elección vale para esta sesión aunque no se pueda guardar.
  }
  apply();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getThemePref, () => 'system');
}

/**
 * Sincroniza el tema con el documento y, con "Sistema", sigue los cambios del sistema operativo
 * sin recargar. Se llama una vez al arrancar; devuelve la función para dejar de escuchar.
 */
export function startThemeSync(): () => void {
  apply();
  if (typeof matchMedia !== 'function') return () => {};
  const media = matchMedia(DARK_QUERY);
  const onChange = () => {
    if (pref === 'system') apply();
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
