/**
 * Puerto: ¿la empresa está activa? (SPEC 16). Lo consultan los caminos que no pasan por la sesión: el
 * webhook entrante, la respuesta de la IA y el dispatcher del Outbox.
 */
export interface TenantStatusReader {
  /** `false` si está inactiva o no existe. */
  isActive(tenantId: string): Promise<boolean>;
}

export const TENANT_STATUS = Symbol('TENANT_STATUS');
