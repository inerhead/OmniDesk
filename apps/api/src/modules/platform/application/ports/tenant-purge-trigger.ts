/** Despierta el job de borrado (SPEC 20) sin esperarlo: el borrado no espera al minuto siguiente. */
export interface TenantPurgeTrigger {
  wake(): void;
}

export const TENANT_PURGE_TRIGGER = Symbol('TENANT_PURGE_TRIGGER');
