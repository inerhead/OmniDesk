import { WhatsAppCloudProvider } from '../../whatsapp/whatsapp-cloud-provider';
import { Inject, Injectable } from '@nestjs/common';
import {
  CHANNEL_REPOSITORY,
  type ChannelForSend,
  type ChannelRepository,
} from '../../channels/application/ports/channel.repository';
import {
  ChannelNotConfiguredError,
  type MessagingProvider,
  type MessagingProviderRegistry,
  type SendMessageRequest,
} from '../application/ports/messaging-provider.port';
import { N8nMessagingProvider } from './n8n-messaging-provider';
import { SimulatedMessagingProvider } from './simulated-messaging-provider';

/** `CUSTOM` todavía no tiene adaptador: sus envíos fallan como canal no configurado. */
const unsupported: MessagingProvider = {
  send(request: SendMessageRequest): Promise<never> {
    return Promise.reject(
      new ChannelNotConfiguredError(
        `el proveedor del canal ${request.channel.id} no tiene adaptador`,
      ),
    );
  },
};

@Injectable()
export class ChannelMessagingProviderRegistry implements MessagingProviderRegistry {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    private readonly simulated: SimulatedMessagingProvider,
    private readonly n8n: N8nMessagingProvider,
    private readonly whatsapp: WhatsAppCloudProvider,
  ) {}

  async resolve(
    tenantId: string,
    channelId: string,
  ): Promise<{ provider: MessagingProvider; channel: ChannelForSend } | null> {
    const channel = await this.channels.findForSend(tenantId, channelId);
    if (!channel) return null;
    switch (channel.provider) {
      case 'SIMULATED':
        return { provider: this.simulated, channel };
      case 'WHATSAPP_CLOUD':
        return { provider: this.whatsapp, channel };
      case 'N8N':
        return { provider: this.n8n, channel };
      default:
        return { provider: unsupported, channel };
    }
  }
}
