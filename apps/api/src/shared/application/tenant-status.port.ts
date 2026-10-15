import type { TenantState } from '../kernel/tenant-state';

/**
 * Puerto: ¿en qué estado está la empresa? (SPEC 16 y 18). Lo consultan los caminos que no pasan por
 * la sesión: el webhook entrante, la respuesta de la IA y el dispatcher del Outbox.
 */
export interface TenantStatusReader {
  /** `null` si la empresa no existe. */
  state(tenantId: string): Promise<TenantState | null>;
  /** `false` si no está activa (en revisión, suspendida o inactiva) o no existe. */
  isActive(tenantId: string): Promise<boolean>;
}

export const TENANT_STATUS = Symbol('TENANT_STATUS');
