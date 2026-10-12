/** Vida de una sesión sin actividad; cada uso la extiende (expiración deslizante). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** `lastSeenAt` se actualiza como máximo una vez por este intervalo. */
export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export interface Session {
  id: string;
  userId: string;
  /** Empresa con la que trabaja la sesión; `null` si el usuario no tiene membresías. */
  activeTenantId: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function newSessionWindow(now: Date): Pick<Session, 'lastSeenAt' | 'expiresAt'> {
  return { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) };
}

export function isSessionActive(session: Session, now: Date): boolean {
  return session.revokedAt === null && session.expiresAt.getTime() > now.getTime();
}

/** Nueva ventana si pasó el intervalo desde el último uso; `null` si no hay que tocar la sesión. */
export function slideSession(
  session: Session,
  now: Date,
): Pick<Session, 'lastSeenAt' | 'expiresAt'> | null {
  if (now.getTime() - session.lastSeenAt.getTime() < LAST_SEEN_THROTTLE_MS) return null;
  return newSessionWindow(now);
}
