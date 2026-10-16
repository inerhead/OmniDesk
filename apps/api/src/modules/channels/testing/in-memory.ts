import type { ChannelRepository } from '../application/ports/channel.repository';
import type { ChannelSecretCipher } from '../application/ports/channel-secret-cipher';
import type { ChannelSummary, SecretBlob } from '../domain/channel';

/** Dobles en memoria para las pruebas unitarias de los casos de uso de canales. */

/** Cifrado reversible de prueba: guarda el texto tal cual. */
export const plainCipher: ChannelSecretCipher = {
  encrypt: (plain) => new TextEncoder().encode(plain) as SecretBlob,
  decrypt: (blob) => new TextDecoder().decode(blob),
};

interface StoredChannel extends ChannelSummary {
  n8nClientSecretEnc: SecretBlob | null;
}

/** Solo lo que usan las credenciales de cliente de n8n (SPEC 22). */
export class InMemoryChannels implements Pick<
  ChannelRepository,
  'findSummary' | 'setN8nClient' | 'clearN8nClient'
> {
  readonly byId = new Map<string, StoredChannel>();

  add(channel: Partial<StoredChannel> & Pick<ChannelSummary, 'id' | 'tenantId'>): StoredChannel {
    const stored: StoredChannel = {
      name: 'WhatsApp',
      type: 'WHATSAPP',
      provider: 'WHATSAPP_CLOUD',
      externalId: `ext-${channel.id}`,
      phoneNumber: null,
      webhookUrl: null,
      credentialsRotatedAt: null,
      aiEnabled: false,
      hasWhatsAppCredentials: true,
      n8nClientId: null,
      hasN8nClientSecret: false,
      n8nClientSecretEnc: null,
      ...channel,
    };
    this.byId.set(stored.id, stored);
    return stored;
  }

  private find(tenantId: string, channelId: string): StoredChannel | null {
    const channel = this.byId.get(channelId);
    return channel?.tenantId === tenantId ? channel : null;
  }

  async findSummary(tenantId: string, channelId: string): Promise<ChannelSummary | null> {
    const channel = this.find(tenantId, channelId);
    if (!channel) return null;
    const { n8nClientSecretEnc, ...summary } = channel;
    return { ...summary, hasN8nClientSecret: n8nClientSecretEnc !== null };
  }

  async setN8nClient(
    tenantId: string,
    channelId: string,
    { clientId, clientSecretEnc }: { clientId: string; clientSecretEnc?: SecretBlob },
  ): Promise<boolean> {
    const channel = this.find(tenantId, channelId);
    if (!channel) return false;
    channel.n8nClientId = clientId;
    if (clientSecretEnc) channel.n8nClientSecretEnc = clientSecretEnc;
    return true;
  }

  async clearN8nClient(tenantId: string, channelId: string): Promise<boolean> {
    const channel = this.find(tenantId, channelId);
    if (!channel) return false;
    Object.assign(channel, { n8nClientId: null, n8nClientSecretEnc: null, aiEnabled: false });
    return true;
  }
}
