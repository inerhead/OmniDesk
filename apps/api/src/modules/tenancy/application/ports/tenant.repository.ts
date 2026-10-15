import type { RetentionDays } from '../../domain/retention';
import type { Tenant, TenantDetails } from '../../domain/tenant';

export interface TenantRepository {
  findBySlug(slug: string): Promise<Tenant | null>;
  upsertBySlug(data: { slug: string; name: string }): Promise<Tenant>;
  /** Lanza `UniqueConflictError` si el slug ya existe. */
  create(data: { slug: string; name: string }): Promise<Tenant>;
  findDetails(tenantId: string): Promise<TenantDetails | null>;
  /** Clave del logo y estado; `null` si la empresa no existe. */
  findLogo(tenantId: string): Promise<{ logoKey: string | null; active: boolean } | null>;
  /** Lanza `UniqueConflictError` si el slug ya existe. */
  update(
    tenantId: string,
    data: { name?: string; slug?: string; retentionDays?: RetentionDays },
  ): Promise<void>;
  /** Conversaciones `CLOSED` con el último mensaje antes de `cutoff` (vista previa de la retención). */
  countClosedConversationsBefore(tenantId: string, cutoff: Date): Promise<number>;
  /**
   * Cambia (o, con `null`, quita) el logo y devuelve la clave anterior para borrarla. La fila se
   * bloquea: dos subidas a la vez no pierden la clave vieja.
   */
  replaceLogo(
    tenantId: string,
    next: { key: string; at: Date } | null,
  ): Promise<{ previousKey: string | null }>;
  /** Marca la empresa inactiva solo si estaba activa; `false` = ya lo estaba. */
  deactivate(tenantId: string, byMemberId: string, at: Date): Promise<boolean>;
  /** Marca la empresa activa solo si estaba inactiva; `false` = ya lo estaba. */
  reactivate(tenantId: string): Promise<boolean>;
  /** Revoca las invitaciones pendientes (al inactivar). Devuelve cuántas. */
  revokePendingInvitations(tenantId: string, at: Date): Promise<number>;
}

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');
