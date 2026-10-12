import type { ConversationStatus } from '../../domain/conversation';
import type { Message } from '../../domain/message';

export interface ConversationSummaryView {
  id: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  contact: { id: string; displayName: string | null; externalId: string };
  channel: { id: string; name: string; type: 'WHATSAPP' };
  lastMessageAt: Date;
  lastMessagePreview: string;
}

export interface ConversationPosition {
  lastMessageAt: Date;
  id: string;
}

/** Consultas de lectura para la bandeja; siempre filtradas por tenant. */
export interface ConversationReadModel {
  /** Orden `lastMessageAt DESC, id DESC`, empezando después de `after`. */
  listSummaries(
    tenantId: string,
    after: ConversationPosition | null,
    take: number,
  ): Promise<ConversationSummaryView[]>;
  conversationExists(tenantId: string, conversationId: string): Promise<boolean>;
  /** Orden `sequence DESC`, solo `sequence < before` si se indica. */
  listMessagesDescending(
    conversationId: string,
    before: number | null,
    take: number,
  ): Promise<Message[]>;
}

export const CONVERSATION_READ_MODEL = Symbol('CONVERSATION_READ_MODEL');
