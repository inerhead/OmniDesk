export type ConversationEventType = 'ASSIGNED' | 'RELEASED' | 'CLOSED' | 'REOPENED';

export interface ConversationEvent {
  id: string;
  conversationId: string;
  /** Comparte el contador `lastSequence` con los mensajes. */
  sequence: number;
  type: ConversationEventType;
  /** `null` = sistema (reapertura por un mensaje del cliente). */
  actorMemberId: string | null;
  /** Agente asignado en `ASSIGNED`. */
  targetMemberId: string | null;
  createdAt: Date;
}

/** Datos de un evento antes de asignarle `sequence`. */
export interface NewConversationEvent {
  type: ConversationEventType;
  actorMemberId: string | null;
  targetMemberId: string | null;
}
