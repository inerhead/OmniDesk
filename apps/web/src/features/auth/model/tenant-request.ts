import type { Membership, MeResponse } from '@omnidesk/contracts';

/** Abre el formulario de alta aunque el usuario ya tenga empresas («Crear empresa» del menú). */
export const CREATE_TENANT_PATH = '/onboarding?create=1';

/** Ya es OWNER de una empresa en revisión (SPEC 18): una solicitud a la vez. */
export function hasPendingRequest(me: Pick<MeResponse, 'memberships'>): boolean {
  return me.memberships.some(
    (membership) => membership.role === 'OWNER' && membership.tenantState === 'pending',
  );
}

/**
 * La empresa activa, si está en revisión o suspendida por la plataforma (SPEC 18): toda ruta muestra
 * la espera o el aviso. `null` si se puede usar (o está inactiva: eso lo resuelve SPEC 16).
 */
export function blockedActiveMembership(me: MeResponse | undefined): Membership | null {
  const membership = me?.memberships.find((item) => item.tenantId === me.activeTenantId);
  if (!membership) return null;
  return membership.tenantState === 'pending' || membership.tenantState === 'suspended'
    ? membership
    : null;
}

/** Sin otras empresas, la espera vive en `/onboarding` en lugar de dentro de la app. */
export function waitsInOnboarding(me: MeResponse | undefined): boolean {
  const blocked = blockedActiveMembership(me);
  return blocked?.tenantState === 'pending' && me!.memberships.length === 1;
}

/** Aviso de rechazo dentro de la app: solo con otras empresas (sin ninguna, va en `/onboarding`). */
export function showsRejectionNotice(me: MeResponse | undefined): boolean {
  return Boolean(me?.tenantRejection) && (me?.memberships.length ?? 0) > 0;
}

/** Etiqueta del estado en el selector de empresas; `null` si está activa. */
export function tenantStateLabel(state: Membership['tenantState']): string | null {
  if (state === 'pending') return 'En revisión';
  if (state === 'suspended') return 'Suspendida';
  if (state === 'inactive') return 'Inactiva';
  return null;
}
