import type { Channel } from '@omnidesk/contracts';

type ChannelState = Pick<
  Channel,
  'provider' | 'webhookUrl' | 'hasCredentials' | 'aiEnabled' | 'hasWhatsAppCredentials'
>;

export interface ChannelBadge {
  key: 'meta' | 'ai' | 'n8n';
  label: string;
  ok: boolean;
}

export type ChannelStepKey = 'meta' | 'ai' | 'credentials';

export interface ChannelStep {
  key: ChannelStepKey;
  /** 1, 2, 3; en un canal n8n (sin paso de Meta) se renumera desde 1. */
  number: number;
  title: string;
  done: boolean;
}

const isCloud = (channel: ChannelState) => channel.provider === 'WHATSAPP_CLOUD';

/** IA activa: el interruptor en WhatsApp Cloud; en un canal n8n, que tenga webhook. */
const aiActive = (channel: ChannelState) =>
  isCloud(channel) ? channel.aiEnabled : channel.webhookUrl !== null;

/** Insignias de la lista de canales (SPEC 17): Meta (solo WhatsApp Cloud), IA y n8n. */
export function channelBadges(channel: ChannelState): ChannelBadge[] {
  const n8nReady = channel.webhookUrl !== null && channel.hasCredentials;
  return [
    ...(isCloud(channel)
      ? [
          {
            key: 'meta' as const,
            label: channel.hasWhatsAppCredentials ? 'Meta conectado' : 'Meta pendiente',
            ok: channel.hasWhatsAppCredentials,
          },
        ]
      : []),
    { key: 'ai', label: aiActive(channel) ? 'IA activa' : 'IA apagada', ok: aiActive(channel) },
    { key: 'n8n', label: n8nReady ? 'n8n listo' : 'n8n pendiente', ok: n8nReady },
  ];
}

/** Pasos del panel de un canal, con su número y si están completos. */
export function channelSteps(channel: ChannelState): ChannelStep[] {
  const steps: Omit<ChannelStep, 'number'>[] = [
    ...(isCloud(channel)
      ? [{ key: 'meta' as const, title: 'Conectar Meta', done: channel.hasWhatsAppCredentials }]
      : []),
    {
      key: 'ai',
      title: 'IA con n8n',
      done: channel.webhookUrl !== null && (!isCloud(channel) || channel.aiEnabled),
    },
    { key: 'credentials', title: 'Credenciales de n8n', done: channel.hasCredentials },
  ];
  return steps.map((step, index) => ({ ...step, number: index + 1 }));
}

export const PROVIDER_LABEL: Record<Channel['provider'], string> = {
  WHATSAPP_CLOUD: 'WhatsApp Cloud',
  N8N: 'n8n',
  SIMULATED: 'Simulado',
  CUSTOM: 'Personalizado',
};
