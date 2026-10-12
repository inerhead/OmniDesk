export type SenderType = 'CUSTOMER' | 'AI' | 'AGENT';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus = 'RECEIVED' | 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
  id: string;
  conversationId: string;
  channelId: string;
  sequence: number;
  direction: MessageDirection;
  senderType: SenderType;
  text: string;
  status: MessageStatus;
  /** Entrantes: id del mensaje en el proveedor. Salientes: el `providerMessageId` del envío. */
  externalId: string | null;
  /** Agente que lo escribió (solo `AGENT`). */
  sender: { id: string; displayName: string } | null;
  failureReason: string | null;
  createdAt: Date;
}

/** Datos de un mensaje antes de asignarle `sequence`. */
export interface NewMessage {
  direction: MessageDirection;
  senderType: SenderType;
  text: string;
  status: MessageStatus;
  externalId?: string;
  idempotencyKey?: string;
  providerTimestamp?: Date;
  /** Agente que escribe (solo `AGENT`). */
  senderMemberId?: string;
  /** Idempotencia del composer de la web. */
  clientMessageId?: string;
}

/** Mensaje del cliente: entrante y ya recibido. */
export function customerMessage(
  text: string,
  externalId: string,
  providerTimestamp: Date,
): NewMessage {
  return {
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    status: 'RECEIVED',
    text,
    externalId,
    providerTimestamp,
  };
}

/** Respuesta de IA: saliente y pendiente de confirmación del proveedor. */
export function aiReply(text: string, idempotencyKey: string): NewMessage {
  return { direction: 'OUTBOUND', senderType: 'AI', status: 'PENDING', text, idempotencyKey };
}

/** Mensaje del agente: saliente y pendiente de que el proveedor lo confirme. */
export function agentMessage(
  text: string,
  senderMemberId: string,
  clientMessageId: string,
): NewMessage {
  return {
    direction: 'OUTBOUND',
    senderType: 'AGENT',
    status: 'PENDING',
    text,
    senderMemberId,
    clientMessageId,
  };
}
