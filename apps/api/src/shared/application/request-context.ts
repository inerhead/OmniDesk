/** Tenant resuelto en el servidor para una petición de la web (hoy: tenant demo; luego: sesión). */
export interface TenantContext {
  tenantId: string;
}

/** Tenant y canal resueltos desde la credencial de una integración (n8n, simulador). */
export interface IntegrationContext {
  tenantId: string;
  channelId: string;
}

/** Miembro con el que actúa la petición (hoy: el que elige la web en modo demo; luego: la sesión). */
export interface ActorContext extends TenantContext {
  memberId: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
}
