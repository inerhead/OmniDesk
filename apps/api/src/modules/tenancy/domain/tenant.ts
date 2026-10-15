export interface Tenant {
  id: string;
  slug: string;
  name: string;
}

/** Empresa con logo y estado, para `/settings/company`. */
export interface TenantDetails extends Tenant, TenantLogoSource {
  /** `null` = activa. */
  deactivatedAt: Date | null;
  deactivatedBy: { id: string; displayName: string; avatarUrl: string | null } | null;
}

/** La demo: el login de desarrollo la busca por este slug, así que no se puede cambiar. */
export const DEMO_TENANT_SLUG = 'demo';

/** Columnas de `tenants` de las que salen el logo y el estado (SPEC 16). */
export interface TenantLogoSource {
  id: string;
  logoKey: string | null;
  logoUpdatedAt: Date | null;
}

/** Logo de la empresa relativo al API, o `null` (iniciales). */
export function tenantLogoUrl(tenant: TenantLogoSource): string | null {
  if (!tenant.logoKey || !tenant.logoUpdatedAt) return null;
  // Igual que `tenantLogoPath` de `@omnidesk/contracts`. El dominio no importa ese paquete.
  return `/api/v1/tenants/${encodeURIComponent(tenant.id)}/logo?v=${tenant.logoUpdatedAt.getTime()}`;
}

/** Logo visto desde una invitación vigente: se sirve por el token, sin sesión. */
export function invitationLogoUrl(
  token: string,
  tenant: Pick<TenantLogoSource, 'logoKey' | 'logoUpdatedAt'>,
): string | null {
  if (!tenant.logoKey || !tenant.logoUpdatedAt) return null;
  // Igual que `invitationLogoPath` de `@omnidesk/contracts`.
  return `/api/v1/invitations/${encodeURIComponent(token)}/logo?v=${tenant.logoUpdatedAt.getTime()}`;
}
