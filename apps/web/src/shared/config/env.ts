import { REALTIME_PATH } from '@omnidesk/contracts';
import { apiBaseFor, basePathFromBaseUrl, parseWebEnv, realtimeTargetFor } from './env-schema';

export const env = parseWebEnv(import.meta.env);

/** Subruta de la app ("/omnidesk"). La fija `base` de Vite en el build. */
export const basePath = basePathFromBaseUrl(import.meta.env.BASE_URL);

/** Prefijo de las llamadas al API: `${apiBase}/api/v1/...` (mismo origen: `/omnidesk/api/v1/...`). */
export const apiBase = apiBaseFor(env.VITE_API_URL, basePath);

/** URL y `path` de Socket.IO (mismo origen: `path` = `/omnidesk/api/realtime`). */
export function realtimeTarget(): { url: string; path: string } {
  return realtimeTargetFor(env.VITE_API_URL, basePath, window.location.origin, REALTIME_PATH);
}

/** URL de un archivo de `public/` (logo, íconos) bajo la subruta. */
export function publicAsset(file: string): string {
  return `${import.meta.env.BASE_URL}${file}`;
}
