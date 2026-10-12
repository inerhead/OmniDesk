import type { Conversation } from '../../domain/conversation';
import type { ConversationEvent, NewConversationEvent } from '../../domain/conversation-event';
import type { ConversationState } from '../../domain/conversation-transitions';
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
  /** La conversación `CLOSED` más reciente del contacto en el canal. */
  findLatestClosed(channelId: string, contactId: string): Promise<Conversation | null>;
  /** Lanza `UniqueConflictError` si ya hay una conversación abierta para ese contacto y canal. */
  createOpen(data: NewConversation): Promise<Conversation>;
  /**
   * Asigna `sequence = lastSequence + 1` de forma atómica, actualiza el resumen y guarda el mensaje.
   * Lanza `UniqueConflictError` ante `externalId` o `idempotencyKey` repetidos.
   */
  appendMessage(conversation: Conversation, message: NewMessage, at: Date): Promise<Message>;
  /**
   * Aplica una transición de estado e incrementa `controlVersion` en 1. Devuelve la conversación
   * actualizada. Debe llamarse con la fila bloqueada (`findByIdForUpdate`).
   */
  applyTransition(conversation: Conversation, next: ConversationState): Promise<Conversation>;
  /** Asigna `sequence = lastSequence + 1` (el mismo contador que los mensajes) y guarda el evento. */
  appendEvent(
    conversation: Conversation,
    event: NewConversationEvent,
    at: Date,
  ): Promise<ConversationEvent>;
  findMessageByExternalId(channelId: string, externalId: string): Promise<Message | null>;
  findMessageByIdempotencyKey(
    conversationId: string,
    idempotencyKey: string,
  ): Promise<Message | null>;
}

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
