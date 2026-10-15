import type { MeResponse } from '@omnidesk/contracts';

export const COMPANY_PATH = '/settings/company';

/**
 * Con la empresa activa inactiva (solo la ve su OWNER), toda ruta lleva a `/settings/company`, que
 * muestra "Reactivar" (SPEC 16). `null` = no hay que redirigir.
 */
export function inactiveTenantRedirect(
  me: MeResponse | undefined,
  pathname: string,
): string | null {
  const membership = me?.memberships.find((item) => item.tenantId === me.activeTenantId);
  if (!membership || membership.tenantActive) return null;
  return pathname === COMPANY_PATH ? null : COMPANY_PATH;
}
