import { describe, expect, it } from 'vitest';
import { channelBadges, channelSteps } from './channel-status';

const cloud = {
  provider: 'WHATSAPP_CLOUD' as const,
  webhookUrl: null,
  hasCredentials: false,
  aiEnabled: false,
  hasWhatsAppCredentials: false,
};

describe('channelBadges', () => {
  it('WhatsApp Cloud sin configurar: todo pendiente', () => {
    expect(channelBadges(cloud).map((badge) => [badge.label, badge.ok])).toEqual([
      ['Meta pendiente', false],
      ['IA apagada', false],
      ['n8n pendiente', false],
    ]);
  });

  it('WhatsApp Cloud completo: Meta conectado, IA activa y n8n listo', () => {
    const full = {
      ...cloud,
      webhookUrl: 'https://n8n.example.com/webhook/ai',
      hasCredentials: true,
      aiEnabled: true,
      hasWhatsAppCredentials: true,
    };
    expect(channelBadges(full).map((badge) => badge.label)).toEqual([
      'Meta conectado',
      'IA activa',
      'n8n listo',
    ]);
  });

  it('n8n (legado): sin insignia de Meta y la IA activa con webhook', () => {
    const n8n = { ...cloud, provider: 'N8N' as const, webhookUrl: 'https://n8n.example.com/w' };
    expect(channelBadges(n8n).map((badge) => [badge.key, badge.ok])).toEqual([
      ['ai', true],
      ['n8n', false],
    ]);
  });
});

describe('channelSteps', () => {
  it('WhatsApp Cloud: tres pasos; la IA cuenta solo con webhook y el interruptor', () => {
    const half = {
      ...cloud,
      hasWhatsAppCredentials: true,
      webhookUrl: 'https://n8n.example.com/w',
    };
    expect(channelSteps(half).map((step) => [step.number, step.key, step.done])).toEqual([
      [1, 'meta', true],
      [2, 'ai', false],
      [3, 'credentials', false],
    ]);
  });

  it('n8n (legado): dos pasos renumerados desde 1', () => {
    const n8n = {
      ...cloud,
      provider: 'N8N' as const,
      webhookUrl: 'https://n8n.example.com/w',
      hasCredentials: true,
    };
    expect(channelSteps(n8n).map((step) => [step.number, step.title, step.done])).toEqual([
      [1, 'IA con n8n', true],
      [2, 'Credenciales de n8n', true],
    ]);
  });
});
