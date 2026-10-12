import { Inject, Injectable } from '@nestjs/common';
import { N8nSendMessageResponseSchema, type N8nSendMessageRequest } from '@omnidesk/contracts';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import {
  describeFetchError,
  postSignedJson,
} from '../../../shared/infrastructure/http/signed-webhook';
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
 * Envía por el webhook de n8n del canal (n8n → WhatsApp Cloud API). Firma con el secreto del canal
 * y manda `Idempotency-Key: <messageId>`: un reintento tras una caída no debe entregar dos veces.
 */
@Injectable()
export class N8nMessagingProvider implements MessagingProvider {
  /** Reemplazable en las pruebas. */
  timeoutMs = N8N_SEND_TIMEOUT_MS;

  constructor(
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async send(request: SendMessageRequest): Promise<{ providerMessageId: string }> {
    const { channel } = request;
    if (!channel.hmacSecretEnc) {
      throw new ChannelNotConfiguredError(`el canal ${channel.id} no tiene secreto HMAC`);
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
      response = await postSignedJson(
        channel.webhookUrl,
        this.cipher.decrypt(channel.hmacSecretEnc),
        body,
        {
          nowSec: Math.floor(this.clock.now().getTime() / 1000),
          timeoutMs: this.timeoutMs,
          headers: { 'idempotency-key': request.messageId },
        },
      );
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
