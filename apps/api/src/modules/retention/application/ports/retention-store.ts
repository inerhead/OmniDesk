import type { RetentionDays } from '../../../tenancy/domain/retention';

export interface TenantRetention {
  tenantId: string;
  retentionDays: Exclude<RetentionDays, null>;
}

export interface DeletedConversations {
  conversations: number;
  messages: number;
}

export interface TechnicalPurgeResult {
  outboxEvents: number;
  inboxEvents: number;
  sessions: number;
  invitations: number;
}

/** Acceso a la base del job de retención (SPEC 12). Ve todas las empresas: es un camino de sistema. */
export interface RetentionStore {
  /** Empresas con retención configurada (`retention_days` no nulo). */
  tenantsWithRetention(): Promise<TenantRetention[]>;
  /**
   * Hasta `limit` conversaciones `CLOSED` con el último mensaje antes de `cutoff`, bloqueadas hasta
   * el final de la transacción (las que otra transacción tiene bloqueadas se saltan).
   */
  lockExpiredConversations(tenantId: string, cutoff: Date, limit: number): Promise<string[]>;
  /** Claves en el bucket de los adjuntos de esas conversaciones. */
  attachmentKeys(tenantId: string, conversationIds: string[]): Promise<string[]>;
  /** Borra las conversaciones; sus mensajes, eventos y adjuntos caen en cascada. */
  deleteConversations(tenantId: string, conversationIds: string[]): Promise<DeletedConversations>;
  /** Borra los contactos sin conversaciones (sus identidades caen en cascada). Devuelve cuántos. */
  deleteOrphanContacts(tenantId: string): Promise<number>;
  logDeletion(entry: {
    tenantId: string;
    kind: 'contact' | 'retention';
    actorMemberId: string | null;
    conversationsDeleted: number;
    messagesDeleted: number;
  }): Promise<void>;
  /**
   * Bloquea el contacto y sus conversaciones hasta el final de la transacción y devuelve los ids de
   * esas conversaciones (abiertas o cerradas). `null` si el contacto no es de esa empresa.
   */
  lockContactConversations(tenantId: string, contactId: string): Promise<string[] | null>;
  /** Borra el contacto (sus identidades caen en cascada). Debe haberse quedado sin conversaciones. */
  deleteContact(tenantId: string, contactId: string): Promise<void>;
  /** Outbox publicado, Inbox, sesiones e invitaciones terminadas antes de `cutoff`. */
  purgeTechnical(cutoff: Date): Promise<TechnicalPurgeResult>;
}

export const RETENTION_STORE = Symbol('RETENTION_STORE');
