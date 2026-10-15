import type { TenantState } from '../../tenancy/domain/tenant-state';

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
  /** Logo de la empresa (SPEC 16); `null` = iniciales. */
  tenantLogoUrl: string | null;
  /** `true` solo con `tenantState === 'active'`. */
  tenantActive: boolean;
  /** Estado efectivo (SPEC 16 y 18). */
  tenantState: TenantState;
  /** Motivo de la suspensión de la plataforma; `null` si no está suspendida. */
  suspensionReason: string | null;
  /** ISO; `null` si no está suspendida. */
  suspendedAt: string | null;
  /** ISO, solo en una empresa en revisión (la pantalla de espera). */
  requestedAt: string | null;
}

/**
 * Una empresa inactiva solo la ven sus OWNER, para reactivarla (SPEC 16). Una en revisión o
 * suspendida la ven todos sus miembros, para mostrar la espera o el aviso (SPEC 18).
 */
export function canSeeMembership(membership: Pick<Membership, 'role' | 'tenantState'>): boolean {
  return membership.tenantState !== 'inactive' || membership.role === 'OWNER';
}

/**
 * Empresa de respaldo de una sesión, entre las que puede ver (`canSeeMembership`): la primera activa;
 * si no hay, la primera en revisión o suspendida (SPEC 18), para ver la espera o el aviso; si
 * tampoco, la inactiva de un OWNER, para reactivarla (SPEC 16). Sin ninguna, `null` (`/onboarding`).
 */
export function fallbackTenantId(memberships: Membership[]): string | null {
  const active = memberships.find((membership) => membership.tenantState === 'active');
  const waiting = memberships.find(
    (membership) => membership.tenantState === 'pending' || membership.tenantState === 'suspended',
  );
  return (active ?? waiting ?? memberships[0])?.tenantId ?? null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
