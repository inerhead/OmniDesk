import { DEMO_TENANT_SLUG } from '../../tenancy/domain/tenant';
import type { TenantState } from '../../tenancy/domain/tenant-state';

/** Conversaciones que borra cada transacción del job (SPEC 20). */
export const TENANT_PURGE_BATCH_SIZE = 200;

/** Lock de `PgJobLock`: el job corre una sola vez a la vez entre instancias. */
export const TENANT_PURGE_LOCK_NAME = 'omnidesk:tenant-purge';

/** Cada cuánto busca empresas en borrado, además de cuando se pide uno. */
export const TENANT_PURGE_INTERVAL_MS = 60_000;

export type TenantDeletionCheck =
  | 'ok'
  /** Ya está en borrado: se responde igual, sin cambios. */
  | 'already-deleting'
  | 'demo-locked'
  | 'not-suspended'
  | 'confirmation-mismatch';

/**
 * ¿Se puede borrar? Solo una empresa suspendida por la plataforma (dos pasos), nunca la demo con
 * `DEMO_MODE=true`, y con el slug exacto como confirmación (sin recortar espacios).
 */
export function checkTenantDeletion(
  tenant: { slug: string; state: TenantState },
  confirmSlug: string,
  demoMode: boolean,
): TenantDeletionCheck {
  if (tenant.state === 'deleting') return 'already-deleting';
  if (demoMode && tenant.slug === DEMO_TENANT_SLUG) return 'demo-locked';
  if (tenant.state !== 'suspended') return 'not-suspended';
  if (confirmSlug !== tenant.slug) return 'confirmation-mismatch';
  return 'ok';
}

/** Cuenta de un miembro de la empresa que se borra. */
export interface MemberAccount {
  userId: string;
  email: string;
  /** Membresías con `removedAt` nulo en otras empresas (una solicitud en revisión cuenta). */
  otherActiveMemberships: number;
}

/**
 * La cuenta se borra con la empresa si no le queda ninguna otra empresa activa y no es admin de
 * plataforma. Una baja en otra empresa no la salva: ya no da acceso.
 */
export function isOrphanAccount(
  account: MemberAccount,
  isPlatformAdmin: (email: string) => boolean,
): boolean {
  return account.otherActiveMemberships === 0 && !isPlatformAdmin(account.email);
}
