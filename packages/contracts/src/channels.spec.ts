import { describe, expect, it } from 'vitest';
import { AI_REPLY_HISTORY_LIMIT, N8nAiReplyRequestSchema } from './channels';

const request = {
  type: 'ai.reply',
  messageId: '0199c0de-0000-7000-8000-000000000001',
  conversationId: '0199c0de-0000-7000-8000-000000000002',
  controlVersion: 0,
  channel: { id: '0199c0de-0000-7000-8000-000000000003', externalId: '123456789' },
  from: { externalId: '+573001234567', displayName: 'Ana' },
  text: '¿y a qué hora llega?',
};
const message = { role: 'customer', text: 'Hola', at: '2026-10-16T18:00:00.000Z' };

describe('N8nAiReplyRequestSchema (SPEC 24)', () => {
  it('acepta historial vacío y mensajes con rol, agente y adjunto', () => {
    expect(N8nAiReplyRequestSchema.safeParse({ ...request, history: [] }).success).toBe(true);
    const history = [
      message,
      { role: 'agent', agentName: 'Laura', text: 'Sale en 10 minutos', at: message.at },
      { role: 'customer', text: '', attachment: 'IMAGE', at: message.at },
    ];
    expect(N8nAiReplyRequestSchema.safeParse({ ...request, history }).success).toBe(true);
  });

  it('exige history y limita su tamaño', () => {
    expect(N8nAiReplyRequestSchema.safeParse(request).success).toBe(false);
    const history = Array.from({ length: AI_REPLY_HISTORY_LIMIT + 1 }, () => message);
    expect(N8nAiReplyRequestSchema.safeParse({ ...request, history }).success).toBe(false);
  });

  it('rechaza un rol desconocido', () => {
    const history = [{ ...message, role: 'system' }];
    expect(N8nAiReplyRequestSchema.safeParse({ ...request, history }).success).toBe(false);
  });
});
