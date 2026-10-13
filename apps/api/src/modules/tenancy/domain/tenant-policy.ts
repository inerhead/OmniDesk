export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';

/**
 * Crear empresa: quien aún no tiene ninguna (alta nueva) o quien es OWNER en alguna. Un AGENT o ADMIN
 * de empresas ajenas no puede.
 */
export function canCreateTenant(roles: MemberRole[]): boolean {
  return roles.length === 0 || roles.includes('OWNER');
}
