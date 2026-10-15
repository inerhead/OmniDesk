/**
 * Estado efectivo de una empresa (SPEC 16 y 18), en orden de prioridad: en revisión, suspendida por
 * la plataforma, inactivada por su Owner o activa.
 */
export type TenantState = 'pending' | 'suspended' | 'inactive' | 'active';

/** Columnas de `tenants` de las que sale el estado. */
export interface TenantStateSource {
  approval: 'PENDING' | 'APPROVED';
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
}

export function tenantState(tenant: TenantStateSource): TenantState {
  if (tenant.approval === 'PENDING') return 'pending';
  if (tenant.suspendedAt) return 'suspended';
  if (tenant.deactivatedAt) return 'inactive';
  return 'active';
}

/** `select` de Prisma con las columnas del estado. */
export const tenantStateSelect = {
  approval: true,
  suspendedAt: true,
  deactivatedAt: true,
} as const;
