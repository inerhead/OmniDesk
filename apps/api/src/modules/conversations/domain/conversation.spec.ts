import { describe, expect, it } from 'vitest';
import { appendMessage, decideAiReply, isAiActive, toPreview } from './conversation';

const open = { status: 'OPEN' as const, assignedAgentId: null, controlVersion: 0 };

describe('toPreview', () => {
  it('colapsa saltos de línea y espacios', () => {
    expect(toPreview('  Hola\n\n¿cómo   estás?  ')).toBe('Hola ¿cómo estás?');
  });

  it('recorta a 120 caracteres con "…"', () => {
    const preview = toPreview('a'.repeat(200));

    expect(preview).toHaveLength(120);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('no recorta textos de 120 caracteres o menos', () => {
    expect(toPreview('a'.repeat(120))).toBe('a'.repeat(120));
  });
});

describe('isAiActive', () => {
  it('es true con la conversación abierta y sin agente', () => {
    expect(isAiActive(open)).toBe(true);
  });

  it('es false con agente asignado o conversación cerrada', () => {
    expect(isAiActive({ ...open, assignedAgentId: 'agente' })).toBe(false);
    expect(isAiActive({ ...open, status: 'CLOSED' })).toBe(false);
  });
});

describe('decideAiReply', () => {
  it('permite la respuesta con el mismo controlVersion', () => {
    expect(decideAiReply(open, 0)).toEqual({ allowed: true });
  });

  it('rechaza con CONTROL_CHANGED si el controlVersion cambió', () => {
    expect(decideAiReply(open, 99)).toEqual({ allowed: false, reason: 'CONTROL_CHANGED' });
  });

  it('rechaza con CONTROL_CHANGED si hay agente asignado', () => {
    expect(decideAiReply({ ...open, assignedAgentId: 'agente' }, 0)).toEqual({
      allowed: false,
      reason: 'CONTROL_CHANGED',
    });
  });

  it('rechaza con CONVERSATION_CLOSED si la conversación está cerrada', () => {
    expect(decideAiReply({ ...open, status: 'CLOSED' }, 0)).toEqual({
      allowed: false,
      reason: 'CONVERSATION_CLOSED',
    });
  });
});

describe('appendMessage', () => {
  it('avanza la sequence y actualiza el resumen', () => {
    const at = new Date('2026-10-12T10:00:00.000Z');

    expect(appendMessage({ lastSequence: 2 }, 'Hola', at)).toEqual({
      lastSequence: 3,
      lastMessageAt: at,
      lastMessagePreview: 'Hola',
    });
  });
});
