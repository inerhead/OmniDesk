import { DEMO_TENANT_SLUG } from './tenant';

export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

/**
 * Crear empresa: quien aún no tiene ninguna (alta nueva) o quien es OWNER en alguna. Un AGENT o ADMIN
 * de empresas ajenas no puede.
 */
export function canCreateTenant(roles: MemberRole[]): boolean {
  return roles.length === 0 || roles.includes('OWNER');
}

/** Editar la empresa, su logo e inactivarla o reactivarla: solo OWNER (SPEC 16). */
export function canManageTenant(role: MemberRole): boolean {
  return role === 'OWNER';
}

/** La demo conserva su slug: el login de desarrollo la busca por él. */
export function isSlugChangeLocked(currentSlug: string, nextSlug: string | undefined): boolean {
  return nextSlug !== undefined && nextSlug !== currentSlug && currentSlug === DEMO_TENANT_SLUG;
}

/** Inactivar exige escribir el nombre exacto de la empresa (se ignoran los espacios de los bordes). */
export function confirmsTenantName(tenantName: string, confirmName: string): boolean {
  return confirmName.trim() === tenantName.trim();
}
