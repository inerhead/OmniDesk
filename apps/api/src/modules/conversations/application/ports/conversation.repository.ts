import type { Conversation } from '../../domain/conversation';
import type { Message, NewMessage } from '../../domain/message';

export interface NewConversation {
  tenantId: string;
  channelId: string;
  contactId: string;
  at: Date;
  preview: string;
}

export interface ConversationRepository {
  findById(tenantId: string, id: string): Promise<Conversation | null>;
  /** Igual que `findById`, bloqueando la fila hasta el fin de la transacción (`FOR UPDATE`). */
  findByIdForUpdate(tenantId: string, id: string): Promise<Conversation | null>;
  findOpen(channelId: string, contactId: string): Promise<Conversation | null>;
  /** Lanza `UniqueConflictError` si ya hay una conversación abierta para ese contacto y canal. */
  createOpen(data: NewConversation): Promise<Conversation>;
  /**
   * Asigna `sequence = lastSequence + 1` de forma atómica, actualiza el resumen y guarda el mensaje.
   * Lanza `UniqueConflictError` ante `externalId` o `idempotencyKey` repetidos.
   */
  appendMessage(conversation: Conversation, message: NewMessage, at: Date): Promise<Message>;
  findMessageByExternalId(channelId: string, externalId: string): Promise<Message | null>;
  findMessageByIdempotencyKey(
    conversationId: string,
    idempotencyKey: string,
  ): Promise<Message | null>;
}

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
