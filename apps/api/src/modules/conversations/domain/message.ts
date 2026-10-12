export type SenderType = 'CUSTOMER' | 'AI' | 'AGENT';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus = 'RECEIVED' | 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface Message {
  id: string;
  conversationId: string;
  sequence: number;
  direction: MessageDirection;
  senderType: SenderType;
  text: string;
  status: MessageStatus;
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
