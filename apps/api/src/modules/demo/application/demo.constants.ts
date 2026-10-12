import type { NewChannel } from '../../channels/domain/channel';

export const DEMO_TENANT = { slug: 'demo', name: 'Empresa Demo' } as const;

export const DEMO_CHANNEL: NewChannel = {
  name: 'WhatsApp Demo',
  type: 'WHATSAPP',
  provider: 'N8N',
  externalId: 'demo-whatsapp',
};
