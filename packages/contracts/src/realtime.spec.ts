import { describe, expect, it } from 'vitest';
import { CONVERSATION_CHANGED_EVENT, REALTIME_PATH, RealtimeEventSchema } from './realtime';

describe('RealtimeEventSchema', () => {
  const valid = {
    type: 'conversation.changed',
    conversationId: '0199c0de-0000-7000-8000-000000000001',
    reason: 'message',
    occurredAt: '2026-10-12T10:00:00.000Z',
  };

  it('acepta un evento válido', () => {
    expect(RealtimeEventSchema.parse(valid)).toEqual(valid);
  });

  it('rechaza un tipo desconocido', () => {
    expect(RealtimeEventSchema.safeParse({ ...valid, type: 'other' }).success).toBe(false);
  });

  it('acepta el motivo assignment', () => {
    expect(RealtimeEventSchema.safeParse({ ...valid, reason: 'assignment' }).success).toBe(true);
  });

  it('acepta el motivo delivery', () => {
    expect(RealtimeEventSchema.safeParse({ ...valid, reason: 'delivery' }).success).toBe(true);
  });

  it('rechaza un motivo desconocido', () => {
    expect(RealtimeEventSchema.safeParse({ ...valid, reason: 'otro' }).success).toBe(false);
  });

  it('rechaza un conversationId que no es uuid', () => {
    expect(RealtimeEventSchema.safeParse({ ...valid, conversationId: 'abc' }).success).toBe(false);
  });

  it('rechaza una fecha que no es ISO', () => {
    expect(RealtimeEventSchema.safeParse({ ...valid, occurredAt: 'ayer' }).success).toBe(false);
  });

  it('expone la ruta y el nombre del evento', () => {
    expect(REALTIME_PATH).toBe('/api/realtime');
    expect(CONVERSATION_CHANGED_EVENT).toBe(valid.type);
  });
});
