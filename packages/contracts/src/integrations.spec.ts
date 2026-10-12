import { describe, expect, it } from 'vitest';
import {
  DeliveryStatusRequestSchema,
  InboundMessageRequestSchema,
  OutboundAiMessageRequestSchema,
} from './integrations';

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

describe('DeliveryStatusRequestSchema', () => {
  const report = {
    messageId: '0199d8a0-0000-7000-8000-000000000001',
    providerMessageId: 'sim-ai-1',
    status: 'DELIVERED',
    occurredAt: '2026-10-12T10:00:00.000Z',
  };

  it('acepta un reporte válido, con error opcional', () => {
    expect(DeliveryStatusRequestSchema.parse(report)).toEqual(report);
    expect(
      DeliveryStatusRequestSchema.safeParse({ ...report, status: 'FAILED', error: 'sin red' })
        .success,
    ).toBe(true);
  });

  it.each(['PENDING', 'RECEIVED', 'otro'])('rechaza el estado %s', (status) => {
    expect(DeliveryStatusRequestSchema.safeParse({ ...report, status }).success).toBe(false);
  });

  it('rechaza messageId que no es uuid, providerMessageId vacío y error de más de 500', () => {
    expect(DeliveryStatusRequestSchema.safeParse({ ...report, messageId: 'x' }).success).toBe(
      false,
    );
    expect(
      DeliveryStatusRequestSchema.safeParse({ ...report, providerMessageId: '' }).success,
    ).toBe(false);
    expect(
      DeliveryStatusRequestSchema.safeParse({ ...report, error: 'e'.repeat(501) }).success,
    ).toBe(false);
  });
});
