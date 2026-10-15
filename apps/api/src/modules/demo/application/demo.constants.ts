import type { NewChannel } from '../../channels/domain/channel';
import type { NewMember } from '../../members/domain/member';
import { DEMO_TENANT_SLUG } from '../../tenancy/domain/tenant';

export const DEMO_TENANT = { slug: DEMO_TENANT_SLUG, name: 'Empresa Demo' } as const;

export const DEMO_CHANNEL: NewChannel = {
  name: 'WhatsApp Demo',
  type: 'WHATSAPP',
  provider: 'SIMULATED',
  externalId: 'demo-whatsapp',
};

/** Miembros del tenant demo. Hasta el spec de identidad, la web elige con cuál actuar. */
export const DEMO_MEMBERS: readonly NewMember[] = [
  { displayName: 'Sup. Demo', email: 'supervisor@demo.omnidesk.local', role: 'OWNER' },
  { displayName: 'Laura', email: 'laura@demo.omnidesk.local', role: 'AGENT' },
  { displayName: 'Mateo', email: 'mateo@demo.omnidesk.local', role: 'AGENT' },
];
