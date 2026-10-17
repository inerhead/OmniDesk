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

/** Cambios de un mensaje saliente por un estado de entrega. */
export interface MessageDeliveryUpdate {
  status: Message['status'];
  /** Solo si cambia: `providerMessageId` del envío. */
  externalId?: string;
  /** `null` borra el motivo del fallo anterior. */
  failureReason: string | null;
  at: Date;
}

/** Mensaje saliente listo para entregar al proveedor, con el teléfono del destinatario. */
export interface OutboundForSend {
  message: Message;
  tenantId: string;
  to: string;
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
  findMessageById(tenantId: string, messageId: string): Promise<Message | null>;
  /** Idempotencia del composer: el mensaje que ya creó ese `clientMessageId`, si existe. */
  findMessageByClientId(conversationId: string, clientMessageId: string): Promise<Message | null>;
  /** Mensaje saliente con el teléfono del contacto en el canal, o `null` si no existe. */
  findOutboundForSend(tenantId: string, messageId: string): Promise<OutboundForSend | null>;
  /** Actualiza el estado de entrega. La fila de la conversación debe estar bloqueada. */
  updateMessageDelivery(messageId: string, update: MessageDeliveryUpdate): Promise<Message>;
  findMessageByExternalId(channelId: string, externalId: string): Promise<Message | null>;
  findMessageByIdempotencyKey(
    conversationId: string,
    idempotencyKey: string,
  ): Promise<Message | null>;
  /** Salientes `FAILED` de la empresa con ese motivo (SPEC 16: los cortados por inactivarla). */
  listFailedOutboundByReason(
    tenantId: string,
    reason: string,
  ): Promise<Array<{ id: string; conversationId: string }>>;
  /** Cambia el motivo de los salientes `FAILED` con `from` a `to` (SPEC 18). Devuelve cuántos. */
  relabelFailedOutbound(tenantId: string, from: string, to: string): Promise<number>;
  /**
   * Los `limit` mensajes más recientes con `sequence < beforeSequence`, en orden ascendente, sin los
   * salientes `FAILED` (SPEC 24: historial para la IA).
   */
  listAiHistory(
    tenantId: string,
    conversationId: string,
    beforeSequence: number,
    limit: number,
  ): Promise<Message[]>;
}

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
