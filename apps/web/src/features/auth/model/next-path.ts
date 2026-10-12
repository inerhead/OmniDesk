export const DEFAULT_NEXT_PATH = '/conversations';

/** `next` de `/login?next=`: solo rutas internas ("/…", nunca "//…" ni URLs absolutas). */
export function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}

/** `/login?next=<ruta actual>`; desde `/login` no se anida. */
export function loginPathFor(currentPath: string): string {
  if (currentPath.startsWith('/login')) return currentPath;
  return `/login?${new URLSearchParams({ next: currentPath })}`;
}
