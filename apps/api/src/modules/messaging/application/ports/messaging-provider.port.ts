export interface SendMessageRequest {
  tenantId: string;
  channelId: string;
  /** Id del mensaje en OmniDesk. */
  messageId: string;
  /** Teléfono E.164 del destinatario. */
  to: string;
  text: string;
}

/**
 * Puerto hacia el proveedor de mensajería (arquitectura §13).
 *
 * Idempotencia: si el proceso cae entre `send` y marcar el mensaje `SENT`, el dispatcher volverá a
 * llamar a `send` con el mismo `messageId`. Un adaptador real debe usarlo como clave de idempotencia
 * ante el proveedor, para no entregar el mensaje dos veces.
 */
export interface MessagingProvider {
  /** Lanza un error si el proveedor falla: el dispatcher lo reintenta con backoff. */
  send(request: SendMessageRequest): Promise<{ providerMessageId: string }>;
}

export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');
