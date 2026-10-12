export type ChannelType = 'WHATSAPP';
export type ChannelProvider = 'N8N' | 'CUSTOM';

export interface Channel {
  id: string;
  tenantId: string;
  name: string;
  type: ChannelType;
  provider: ChannelProvider;
  externalId: string;
}

export type NewChannel = Omit<Channel, 'id' | 'tenantId'>;
