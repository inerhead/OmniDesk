import type { Channel } from '@omnidesk/contracts';

type ChannelState = Pick<
  Channel,
  | 'provider'
  | 'webhookUrl'
  | 'aiEnabled'
  | 'hasWhatsAppCredentials'
  | 'n8nClientId'
  | 'hasN8nClientSecret'
>;

export interface ChannelBadge {
  key: 'meta' | 'ai' | 'n8n';
  label: string;
  ok: boolean;
}

export type ChannelStepKey = 'meta' | 'ai';

export interface ChannelStep {
  key: ChannelStepKey;
  /** 1, 2; en un canal n8n (sin paso de Meta) se renumera desde 1. */
  number: number;
  title: string;
  done: boolean;
}

const isCloud = (channel: ChannelState) => channel.provider === 'WHATSAPP_CLOUD';

/** n8n tiene a dónde llamar y con qué autenticarse (SPEC 22). */
export const n8nReady = (channel: ChannelState) =>
  channel.webhookUrl !== null && channel.n8nClientId !== null && channel.hasN8nClientSecret;

/** IA activa: el interruptor en WhatsApp Cloud; en un canal n8n, que tenga webhook. */
const aiActive = (channel: ChannelState) =>
  isCloud(channel) ? channel.aiEnabled : channel.webhookUrl !== null;

/** Insignias de la lista de canales (SPEC 17): Meta (solo WhatsApp Cloud), IA y n8n. */
export function channelBadges(channel: ChannelState): ChannelBadge[] {
  const ready = n8nReady(channel);
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
    { key: 'n8n', label: ready ? 'n8n listo' : 'n8n pendiente', ok: ready },
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
      done: n8nReady(channel) && (!isCloud(channel) || channel.aiEnabled),
    },
  ];
  return steps.map((step, index) => ({ ...step, number: index + 1 }));
}

export const PROVIDER_LABEL: Record<Channel['provider'], string> = {
  WHATSAPP_CLOUD: 'WhatsApp Cloud',
  N8N: 'n8n',
  SIMULATED: 'Simulado',
  CUSTOM: 'Personalizado',
};
