import { Inject, Injectable } from '@nestjs/common';
import { N8nSendMessageResponseSchema, type N8nSendMessageRequest } from '@omnidesk/contracts';
import { describeFetchError, postJson } from '../../../shared/infrastructure/http/signed-webhook';
import { n8nClientHeaders } from '../../channels/domain/channel';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../../channels/application/ports/channel-secret-cipher';
import {
  ChannelNotConfiguredError,
  type MessagingProvider,
  type SendMessageRequest,
} from '../application/ports/messaging-provider.port';

export const N8N_SEND_TIMEOUT_MS = 10_000;

/**
 * Envía por el webhook de n8n del canal (n8n → WhatsApp Cloud API). Se autentica con las
 * credenciales de cliente del canal (SPEC 22) y manda `Idempotency-Key: <messageId>`: un reintento
 * tras una caída no debe entregar dos veces.
 */
@Injectable()
export class N8nMessagingProvider implements MessagingProvider {
  /** Reemplazable en las pruebas. */
  timeoutMs = N8N_SEND_TIMEOUT_MS;

  constructor(@Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher) {}

  async send(request: SendMessageRequest): Promise<{ providerMessageId: string }> {
    if (request.attachment) throw new ChannelNotConfiguredError('el canal n8n no admite adjuntos');
    const { channel } = request;
    if (!channel.n8nClientId || !channel.n8nClientSecretEnc) {
      throw new ChannelNotConfiguredError(
        `el canal ${channel.id} no tiene credenciales de cliente de n8n`,
      );
    }
    if (!channel.webhookUrl) {
      throw new ChannelNotConfiguredError(`el canal ${channel.id} no tiene webhookUrl`);
    }

    const body: N8nSendMessageRequest = {
      type: 'message.send',
      messageId: request.messageId,
      conversationId: request.conversationId,
      channel: { id: channel.id, externalId: channel.externalId },
      to: request.to,
      text: request.text,
    };
    let response;
    try {
      response = await postJson(channel.webhookUrl, body, {
        timeoutMs: this.timeoutMs,
        headers: {
          'idempotency-key': request.messageId,
          ...n8nClientHeaders(channel.n8nClientId, this.cipher.decrypt(channel.n8nClientSecretEnc)),
        },
      });
    } catch (error) {
      throw new Error(`n8n no respondió: ${describeFetchError(error)}`, { cause: error });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`n8n respondió HTTP ${response.status}`);
    }
    const parsed = N8nSendMessageResponseSchema.safeParse(response.json);
    if (!parsed.success) throw new Error('n8n respondió sin providerMessageId');
    return { providerMessageId: parsed.data.providerMessageId };
  }
}
