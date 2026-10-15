/** Clave nueva en cada subida: la caché `immutable` nunca sirve un logo viejo con la URL nueva. */
export function tenantLogoStorageKey(tenantId: string, token: string): string {
  return `tenants/${tenantId}/logo-${token}`;
}
