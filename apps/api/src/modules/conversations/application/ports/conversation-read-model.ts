import type { Conversation, ConversationStatus } from '../../domain/conversation';
import type { ConversationEventType } from '../../domain/conversation-event';
import type { Message } from '../../domain/message';

export interface MemberRef {
  id: string;
  displayName: string;
}

export interface ConversationSummaryView {
  id: string;
  status: ConversationStatus;
  assignedAgent: MemberRef | null;
  controlVersion: number;
  contact: { id: string; displayName: string | null; externalId: string };
  channel: { id: string; name: string; type: 'WHATSAPP'; aiEnabled?: boolean };
  lastMessageAt: Date;
  lastMessagePreview: string;
  lastInboundAt: Date | null;
  createdAt: Date;
}

export interface ConversationPosition {
  lastMessageAt: Date;
  id: string;
}

/** Búsqueda por nombre del contacto (`ILIKE`) o, si hay `phoneDigits`, también por teléfono. */
export interface ConversationSearch {
  name: string;
  phoneDigits?: string;
}

/**
 * Filtro de una bandeja. `assignedAgentId`: `null` = sin asignar; sin definir = cualquiera.
 * `search` se combina con `AND` con el resto.
 */
export interface ConversationFilter {
  status: ConversationStatus;
  assignedAgentId?: string | null;
  search?: ConversationSearch;
  /** Solo conversaciones de este canal. */
  channelId?: string;
}

/** Evento ya resuelto con los nombres de actor y destino, para la línea de tiempo. */
export interface ConversationEventView {
  id: string;
  sequence: number;
  type: ConversationEventType;
  actor: MemberRef | null;
  target: MemberRef | null;
  createdAt: Date;
}

/** Consultas de lectura para la bandeja; siempre filtradas por tenant. */
export interface ConversationReadModel {
  /** Orden `lastMessageAt DESC, id DESC`, empezando después de `after`. */
  listSummaries(
    tenantId: string,
    filter: ConversationFilter,
    after: ConversationPosition | null,
    take: number,
  ): Promise<ConversationSummaryView[]>;
  getSummary(tenantId: string, conversationId: string): Promise<ConversationSummaryView | null>;
  /** Cuántas conversaciones cumplen el filtro (los contadores de las bandejas). */
  countConversations(tenantId: string, filter: ConversationFilter): Promise<number>;
  /** Conversaciones abiertas asignadas al miembro (para devolverlas a la IA al quitarlo). */
  listAssignedOpen(
    tenantId: string,
    memberId: string,
  ): Promise<Array<{ id: string; controlVersion: number }>>;
  /** Estado de acceso de la conversación, o `null` si no existe en el tenant. */
  findAccess(
    tenantId: string,
    conversationId: string,
  ): Promise<Pick<Conversation, 'status' | 'assignedAgentId'> | null>;
  /** Orden `sequence DESC`, solo `sequence < before` si se indica. */
  listMessagesDescending(
    conversationId: string,
    before: number | null,
    take: number,
  ): Promise<Message[]>;
  /** Igual que `listMessagesDescending`, para los eventos de la conversación. */
  listEventsDescending(
    conversationId: string,
    before: number | null,
    take: number,
  ): Promise<ConversationEventView[]>;
}

export const CONVERSATION_READ_MODEL = Symbol('CONVERSATION_READ_MODEL');
