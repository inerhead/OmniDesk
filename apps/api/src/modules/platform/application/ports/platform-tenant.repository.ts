import type { PlatformTenant } from '../../domain/platform-tenant';

/**
 * Empresas de todas las organizaciones (SPEC 18). Cruza empresas: va con el rol dueño (camino de
 * sistema, SPEC 12), solo detrás de `PlatformAdminGuard`.
 */
export interface PlatformTenantRepository {
  /** En revisión, la más antigua primero. */
  listPending(): Promise<PlatformTenant[]>;
  /** Aprobadas, la más reciente primero. */
  listApproved(): Promise<PlatformTenant[]>;
  /** Con la fila bloqueada: dos admins a la vez no deciden dos veces. */
  findForUpdate(tenantId: string): Promise<PlatformTenant | null>;
  approve(tenantId: string, byUserId: string, at: Date): Promise<void>;
  /** Borra una empresa en revisión y su membresía (rechazo). */
  deletePending(tenantId: string): Promise<void>;
  /** `false` si ya estaba suspendida. */
  suspend(tenantId: string, data: { byUserId: string; reason: string; at: Date }): Promise<boolean>;
  /** `false` si no estaba suspendida. */
  unsuspend(tenantId: string): Promise<boolean>;
  /** Las sesiones con esta empresa activa la sueltan: `/me` elige la de respaldo. */
  releaseSessions(tenantId: string): Promise<number>;
}

export const PLATFORM_TENANT_REPOSITORY = Symbol('PLATFORM_TENANT_REPOSITORY');
