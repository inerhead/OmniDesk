/**
 * URL pública de una ruta de la web. `APP_URL` ya incluye la subruta (`https://x.com/omnidesk`),
 * así que se concatena: `new URL('/login', APP_URL)` la perdería.
 */
export function publicUrl(appUrl: string, path: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Ruta pública de una ruta interna del API (`/api/v1/...`) tras el prefijo que quita el gateway. */
export function publicPath(basePath: string, path: string): string {
  return `${basePath}${path}` || '/';
}
