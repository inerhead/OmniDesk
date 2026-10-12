import { describe, expect, it } from 'vitest';
import { contactLabel, toBubbleView } from './to-bubble-view';

describe('toBubbleView', () => {
  it('pone al cliente a la izquierda sin etiqueta', () => {
    expect(toBubbleView({ senderType: 'CUSTOMER', status: 'RECEIVED' })).toEqual({
      align: 'start',
      tone: 'customer',
      label: null,
      pending: false,
    });
  });

  it('pone a la IA a la derecha con la etiqueta "IA" y marca PENDING', () => {
    expect(toBubbleView({ senderType: 'AI', status: 'PENDING' })).toEqual({
      align: 'end',
      tone: 'ai',
      label: 'IA',
      pending: true,
    });
  });

  it('pone al agente a la derecha con la etiqueta "Agente"', () => {
    expect(toBubbleView({ senderType: 'AGENT', status: 'SENT' })).toMatchObject({
      align: 'end',
      label: 'Agente',
    });
  });
});

describe('contactLabel', () => {
  it('usa el nombre o, si falta, el teléfono', () => {
    expect(contactLabel({ displayName: 'Ana', externalId: '+573001110001' })).toBe('Ana');
    expect(contactLabel({ displayName: null, externalId: '+573001110001' })).toBe('+573001110001');
  });
});
