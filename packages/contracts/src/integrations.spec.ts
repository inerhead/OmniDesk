import { describe, expect, it } from 'vitest';
import { InboundMessageRequestSchema, OutboundAiMessageRequestSchema } from './integrations';

const inbound = {
  externalMessageId: 'wamid.123',
  from: { externalId: '+573001234567', displayName: 'Ana' },
  text: 'Hola',
  sentAt: '2026-10-12T10:00:00.000Z',
};

describe('InboundMessageRequestSchema', () => {
  it('acepta un mensaje válido', () => {
    expect(InboundMessageRequestSchema.parse(inbound)).toEqual(inbound);
  });

  it('rechaza text vacío o de más de 4096 caracteres', () => {
    expect(InboundMessageRequestSchema.safeParse({ ...inbound, text: '' }).success).toBe(false);
    expect(
      InboundMessageRequestSchema.safeParse({ ...inbound, text: 'a'.repeat(4097) }).success,
    ).toBe(false);
  });

  it('rechaza un teléfono que no es E.164', () => {
    const payload = { ...inbound, from: { externalId: '3001234567' } };
    expect(InboundMessageRequestSchema.safeParse(payload).success).toBe(false);
  });
});

describe('OutboundAiMessageRequestSchema', () => {
  const outbound = {
    conversationId: '0199d8a0-0000-7000-8000-000000000001',
    controlVersion: 0,
    idempotencyKey: 'sim-ana-1',
    text: '¡Hola! ¿En qué te ayudo?',
  };

  it('acepta una respuesta válida', () => {
    expect(OutboundAiMessageRequestSchema.parse(outbound)).toEqual(outbound);
  });

  it('rechaza controlVersion negativo', () => {
    expect(
      OutboundAiMessageRequestSchema.safeParse({ ...outbound, controlVersion: -1 }).success,
    ).toBe(false);
  });
});
