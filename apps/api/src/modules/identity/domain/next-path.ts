export const DEFAULT_NEXT_PATH = '/conversations';

/**
 * `next` solo puede ser una ruta interna relativa ("/conversations?inbox=mine"). Cualquier otra cosa
 * (URL absoluta, "//evil.com", "/\\evil.com", sin "/" inicial) se descarta: evita redirecciones abiertas.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\]/.test(next)) return null;
  return next;
}

/** Destino tras el login: una invitación pendiente manda; sin membresías, el alta de empresa. */
export function postLoginPath(next: string | null, hasMemberships: boolean): string {
  if (next?.startsWith('/invite/')) return next;
  if (!hasMemberships) return '/onboarding';
  return next ?? DEFAULT_NEXT_PATH;
}
