/** Puerto: entrega al proveedor de mensajería el mensaje de un `message.send_requested`. */
export interface OutboundMessageSender {
  /** Lanza si el proveedor falla: el dispatcher reintenta con backoff. */
  send(tenantId: string, payload: unknown): Promise<void>;
  /** Agotados los reintentos: deja el mensaje en `FAILED` con el motivo. */
  fail(tenantId: string, payload: unknown, reason: string): Promise<void>;
}

export const OUTBOUND_MESSAGE_SENDER = Symbol('OUTBOUND_MESSAGE_SENDER');
