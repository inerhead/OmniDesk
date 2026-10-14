export interface User {
  id: string;
  email: string;
  displayName: string;
  /** Ya resuelta con `resolveAvatarUrl`. */
  avatarUrl: string | null;
}

/** Columnas de `users` de las que sale la foto. */
export interface UserAvatarSource {
  id: string;
  googleAvatarUrl: string | null;
  avatarKey: string | null;
  avatarUpdatedAt: Date | null;
}

/** La foto subida gana; si no hay, la de Google; si tampoco, `null` (iniciales). */
export function resolveAvatarUrl(user: UserAvatarSource): string | null {
  if (user.avatarKey && user.avatarUpdatedAt) {
    // Igual que `userAvatarPath` de `@omnidesk/contracts`. El dominio no importa ese paquete.
    return `/api/v1/users/${encodeURIComponent(user.id)}/avatar?v=${user.avatarUpdatedAt.getTime()}`;
  }
  return user.googleAvatarUrl;
}

/** Lo que el login con Google aporta de la persona. */
export interface GoogleIdentity {
  googleSub: string;
  email: string;
  displayName: string;
  /** Foto de Google: se guarda en `googleAvatarUrl` y nunca pisa la subida. */
  avatarUrl: string | null;
}

export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

/** Pertenencia activa de un usuario a una empresa. */
export interface Membership {
  memberId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: MemberRole;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
