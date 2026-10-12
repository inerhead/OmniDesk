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
  channel: { id: string; name: string; type: 'WHATSAPP' };
  lastMessageAt: Date;
  lastMessagePreview: string;
}

export interface ConversationPosition {
  lastMessageAt: Date;
  id: string;
}

/** Filtro de una bandeja. `assignedAgentId`: `null` = sin asignar; sin definir = cualquiera. */
export interface ConversationFilter {
  status: ConversationStatus;
  assignedAgentId?: string | null;
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
