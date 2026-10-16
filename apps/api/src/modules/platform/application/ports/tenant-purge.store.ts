/** Lo que borró un lote de conversaciones (caen en cascada sus mensajes, adjuntos y eventos). */
export interface PurgedConversations {
  conversations: number;
  messages: number;
  attachments: number;
}

/** Lo que borró el paso final, en una transacción. */
export interface PurgedRemainder {
  members: number;
  users: number;
}

/** Contadores que se suman a la constancia. */
export type PurgeProgress = Partial<{
  conversationsDeleted: number;
  messagesDeleted: number;
  attachmentsDeleted: number;
  objectsDeleted: number;
}>;

/**
 * Filas que borra el job de borrado de empresas (SPEC 20). Camino de sistema con el rol dueño: la
 * empresa ya no tiene sesiones ni integraciones que la atiendan.
 */
export interface TenantPurgeStore {
  /** Empresas con `deletionRequestedAt`, la más antigua primero. */
  tenantsToPurge(): Promise<string[]>;
  /** Hasta `limit` conversaciones de la empresa, bloqueadas en la transacción activa. */
  lockConversations(tenantId: string, limit: number): Promise<string[]>;
  deleteConversations(tenantId: string, conversationIds: string[]): Promise<PurgedConversations>;
  /** Suma a la constancia en la transacción activa: un lote y su conteo van juntos. */
  addProgress(tenantId: string, progress: PurgeProgress): Promise<void>;
  /**
   * Borra todo lo que queda de la empresa (canales, contactos, credenciales, invitaciones, Outbox,
   * constancias de SPEC 12, miembros), las cuentas huérfanas con sus sesiones y la fila de `tenants`,
   * y cierra la constancia. En la transacción activa.
   */
  deleteRemainder(tenantId: string, orphanUserIds: string[], at: Date): Promise<PurgedRemainder>;
  /** Guarda el último error en la constancia, fuera de la transacción que falló. */
  recordError(tenantId: string, error: string): Promise<void>;
}

export const TENANT_PURGE_STORE = Symbol('TENANT_PURGE_STORE');
