import type { Tenant } from '../../domain/tenant';

export interface TenantRepository {
  findBySlug(slug: string): Promise<Tenant | null>;
  upsertBySlug(data: { slug: string; name: string }): Promise<Tenant>;
  /** Lanza `UniqueConflictError` si el slug ya existe. */
  create(data: { slug: string; name: string }): Promise<Tenant>;
}

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');
