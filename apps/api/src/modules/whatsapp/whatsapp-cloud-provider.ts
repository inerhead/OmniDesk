import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../shared/config/env';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';
import {
  ChannelNotConfiguredError,
  type MessagingProvider,
  type SendMessageRequest,
} from '../messaging/application/ports/messaging-provider.port';
import { WhatsAppSettings } from './whatsapp-settings';

const SendResponse = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) });
@Injectable()
export class WhatsAppCloudProvider implements MessagingProvider {
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(ENV) private readonly env: Env,
  ) {}
  async send(request: SendMessageRequest): Promise<{ providerMessageId: string }> {
    const channel = await this.settings.find(request.channel.id, request.tenantId);
    if (!channel?.whatsappAccessTokenEnc)
      throw new ChannelNotConfiguredError('falta access token de WhatsApp');
    const res = await fetch(
      `https://graph.facebook.com/${this.env.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(channel.externalId)}/messages`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cipher.decrypt(channel.whatsappAccessTokenEnc)}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: request.to.replace(/^\+/, ''),
          type: 'text',
          text: { body: request.text },
          biz_opaque_callback_data: request.messageId,
        }),
      },
    );
    if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}`);
    return { providerMessageId: SendResponse.parse(await res.json()).messages[0]!.id };
  }
}
