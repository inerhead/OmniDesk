import type { MeResponse } from '@omnidesk/contracts';

/**
 * Crear empresa: quien aún no tiene ninguna o es OWNER en alguna. Copia de la regla del API
 * (`tenancy/domain/tenant-policy.ts`), que siempre decide; aquí solo se oculta el botón.
 */
export function canCreateTenant(me: {
  memberships: Pick<MeResponse['memberships'][number], 'role'>[];
}): boolean {
  return me.memberships.length === 0 || me.memberships.some(({ role }) => role === 'OWNER');
}
