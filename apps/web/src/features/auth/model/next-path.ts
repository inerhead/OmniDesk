export const DEFAULT_NEXT_PATH = '/conversations';

/** `next` de `/login?next=`: solo rutas internas ("/…", nunca "//…" ni URLs absolutas). */
export function safeNextPath(next: string | null, basePath = ''): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  // router.state.location incluye basename; navigate lo añade automáticamente.
  const base = basePath.replace(/\/$/, '');
  if (
    base &&
    (next === base ||
      next.startsWith(`${base}/`) ||
      next.startsWith(`${base}?`) ||
      next.startsWith(`${base}#`))
  ) {
    next = next.slice(base.length) || '/';
    if (next.startsWith('?') || next.startsWith('#')) next = `/${next}`;
  }
  return next.startsWith('//') ? null : next;
}

/** `/login?next=<ruta actual>`; desde `/login` no se anida. */
export function loginPathFor(currentPath: string): string {
  if (currentPath.startsWith('/login')) return currentPath;
  return `/login?${new URLSearchParams({ next: currentPath })}`;
}
