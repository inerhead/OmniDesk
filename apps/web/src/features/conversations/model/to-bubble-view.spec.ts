import type { Message } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { contactLabel, toBubbleView } from './to-bubble-view';

describe('toBubbleView', () => {
  it('pone al cliente a la izquierda sin etiqueta ni ticks', () => {
    expect(toBubbleView({ senderType: 'CUSTOMER', status: 'RECEIVED' })).toEqual({
      align: 'start',
      tone: 'customer',
      label: null,
      pending: false,
      deliveryIcon: null,
      canRetry: false,
    });
  });

  it('pone a la IA a la derecha con la etiqueta "IA" y marca PENDING', () => {
    expect(toBubbleView({ senderType: 'AI', status: 'PENDING' })).toEqual({
      align: 'end',
      tone: 'ai',
      label: 'IA',
      pending: true,
      deliveryIcon: 'pending',
      canRetry: false,
    });
  });

  it('muestra el nombre del agente en lugar de "Agente"', () => {
    const sender = { id: 'laura', displayName: 'Laura', avatarUrl: null };

    expect(toBubbleView({ senderType: 'AGENT', status: 'SENT', sender })).toMatchObject({
      align: 'end',
      label: 'Laura',
    });
    expect(toBubbleView({ senderType: 'AGENT', status: 'SENT', sender: null }).label).toBe(
      'Agente',
    );
  });

  it.each<[Message['status'], string]>([
    ['PENDING', 'pending'],
    ['SENT', 'sent'],
    ['DELIVERED', 'delivered'],
    ['READ', 'read'],
    ['FAILED', 'failed'],
  ])('el estado %s se muestra como %s', (status, icon) => {
    expect(toBubbleView({ senderType: 'AGENT', status }).deliveryIcon).toBe(icon);
    expect(toBubbleView({ senderType: 'AI', status }).deliveryIcon).toBe(icon);
  });

  it('solo un mensaje de agente FAILED se puede reintentar', () => {
    expect(toBubbleView({ senderType: 'AGENT', status: 'FAILED' }).canRetry).toBe(true);
    expect(toBubbleView({ senderType: 'AGENT', status: 'SENT' }).canRetry).toBe(false);
    expect(toBubbleView({ senderType: 'AI', status: 'FAILED' }).canRetry).toBe(false);
  });
});

describe('contactLabel', () => {
  it('usa el nombre o, si falta, el teléfono', () => {
    expect(contactLabel({ displayName: 'Ana', externalId: '+573001110001' })).toBe('Ana');
    expect(contactLabel({ displayName: null, externalId: '+573001110001' })).toBe('+573001110001');
  });
});
