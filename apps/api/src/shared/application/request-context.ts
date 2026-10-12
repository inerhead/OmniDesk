/** Tenant resuelto en el servidor para una petición de la web: la empresa activa de la sesión. */
export interface TenantContext {
  tenantId: string;
}

/** Tenant y canal resueltos desde la credencial de una integración (n8n, simulador). */
export interface IntegrationContext {
  tenantId: string;
  channelId: string;
}

/** Quién actúa: el usuario de la sesión y su membresía en la empresa activa (`SessionGuard`). */
export interface ActorContext extends TenantContext {
  userId: string;
  memberId: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
}

/** Usuario de una sesión válida, tenga o no empresa activa (`/me`, alta de empresa, invitaciones). */
export interface SessionContext {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
}
