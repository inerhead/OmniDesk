import { describe, expect, it } from 'vitest';
import { channelBadges, channelSteps } from './channel-status';

const cloud = {
  provider: 'WHATSAPP_CLOUD' as const,
  webhookUrl: null,
  aiEnabled: false,
  hasWhatsAppCredentials: false,
  hasN8nClientSecret: false,
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
      hasN8nClientSecret: true,
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
  it('WhatsApp Cloud: dos pasos; la IA cuenta con webhook, secreto de cliente e interruptor', () => {
    const half = {
      ...cloud,
      hasWhatsAppCredentials: true,
      webhookUrl: 'https://n8n.example.com/w',
      hasN8nClientSecret: true,
    };
    expect(channelSteps(half).map((step) => [step.number, step.key, step.done])).toEqual([
      [1, 'meta', true],
      [2, 'ai', false],
    ]);
    expect(channelSteps({ ...half, aiEnabled: true }).map((step) => step.done)).toEqual([
      true,
      true,
    ]);
    expect(
      channelSteps({ ...half, aiEnabled: true, hasN8nClientSecret: false }).map(
        (step) => step.done,
      ),
    ).toEqual([true, false]);
  });

  it('n8n (legado): un solo paso, completo con webhook y secreto de cliente', () => {
    const n8n = {
      ...cloud,
      provider: 'N8N' as const,
      webhookUrl: 'https://n8n.example.com/w',
      hasN8nClientSecret: true,
    };
    expect(channelSteps(n8n).map((step) => [step.number, step.title, step.done])).toEqual([
      [1, 'IA con n8n', true],
    ]);
    expect(channelSteps({ ...n8n, hasN8nClientSecret: false }).map((step) => step.done)).toEqual([
      false,
    ]);
  });
});
