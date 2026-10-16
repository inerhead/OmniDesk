import type { MemberAccount } from '../../domain/tenant-purge';

/** Constancia de una empresa borrada o en borrado (SPEC 20). */
export interface TenantDeletionRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  requestedByEmail: string;
  requestedAt: Date;
  /** `null` mientras el job no termina. */
  completedAt: Date | null;
  lastError: string | null;
  membersDeleted: number;
  usersDeleted: number;
  conversationsDeleted: number;
  messagesDeleted: number;
  attachmentsDeleted: number;
  objectsDeleted: number;
}

/** Lo que se borraría con la empresa, sin las cuentas (eso lo decide la regla de huérfanas). */
export interface TenantContentCounts {
  members: number;
  conversations: number;
  messages: number;
  attachments: number;
}

/**
 * Borrado de empresas (SPEC 20). Cruza empresas y lee `tenant_deletions`, que no lleva RLS: va con el
 * rol dueño (camino de sistema, SPEC 12), solo detrás de `PlatformAdminGuard` o desde el job.
 */
export interface TenantDeletionRepository {
  /** Fija `deletionRequestedAt` y crea la constancia, en la transacción activa. */
  request(input: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    requestedByUserId: string;
    requestedByEmail: string;
    at: Date;
  }): Promise<void>;
  /** Todas las constancias, la más reciente primero. */
  list(): Promise<TenantDeletionRecord[]>;
  /** Cuentas de los miembros activos de la empresa, con cuántas otras empresas activas tienen. */
  memberAccounts(tenantId: string): Promise<MemberAccount[]>;
  /** `null` si la empresa no existe. */
  contentCounts(tenantId: string): Promise<TenantContentCounts | null>;
}

export const TENANT_DELETION_REPOSITORY = Symbol('TENANT_DELETION_REPOSITORY');
