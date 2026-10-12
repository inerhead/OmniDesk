import type { ChannelForSend } from '../../../channels/application/ports/channel.repository';

export interface SendMessageRequest {
  tenantId: string;
  /** Canal del mensaje, con su configuración de envío (webhook y secreto cifrado). */
  channel: ChannelForSend;
  conversationId: string;
  /** Id del mensaje en OmniDesk. */
  messageId: string;
  /** Teléfono E.164 del destinatario. */
  to: string;
  text: string;
}

/**
 * Puerto hacia el proveedor de mensajería (arquitectura §13). Hay un adaptador por
 * `Channel.provider`; lo elige `MessagingProviderRegistry`.
 *
 * Idempotencia: si el proceso cae entre `send` y marcar el mensaje `SENT`, el dispatcher volverá a
 * llamar a `send` con el mismo `messageId`. Un adaptador real debe usarlo como clave de idempotencia
 * ante el proveedor, para no entregar el mensaje dos veces.
 */
export interface MessagingProvider {
  /**
   * Lanza un error si el proveedor falla: el dispatcher lo reintenta con backoff. Lanza
   * `ChannelNotConfiguredError` si el canal no puede enviar: el mensaje falla sin reintentos.
   */
  send(request: SendMessageRequest): Promise<{ providerMessageId: string }>;
}

/** Motivo de fallo (`failureReason`) de un canal que no puede enviar. */
export const CHANNEL_NOT_CONFIGURED = 'CHANNEL_NOT_CONFIGURED';

/** El canal no tiene lo necesario para enviar (secreto, webhook o adaptador): reintentar no sirve. */
export class ChannelNotConfiguredError extends Error {
  readonly reason = CHANNEL_NOT_CONFIGURED;

  constructor(detail: string) {
    super(`${CHANNEL_NOT_CONFIGURED}: ${detail}`);
    this.name = 'ChannelNotConfiguredError';
  }
}

/** Elige el adaptador según `Channel.provider`. */
export interface MessagingProviderRegistry {
  /** `null` si el canal no existe en la empresa. */
  resolve(
    tenantId: string,
    channelId: string,
  ): Promise<{ provider: MessagingProvider; channel: ChannelForSend } | null>;
}

export const MESSAGING_PROVIDER_REGISTRY = Symbol('MESSAGING_PROVIDER_REGISTRY');
