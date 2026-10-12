import type { TimelineItem } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { describeEvent, statusLabel } from './describe-event';

type TimelineEvent = Extract<TimelineItem, { kind: 'event' }>;

const sup = { id: 'sup', displayName: 'Sup. Demo' };
const laura = { id: 'laura', displayName: 'Laura' };
const mateo = { id: 'mateo', displayName: 'Mateo' };

const event = (overrides: Partial<TimelineEvent>): TimelineEvent => ({
  kind: 'event',
  id: '0199c0de-0000-7000-8000-000000000001',
  sequence: 2,
  type: 'ASSIGNED',
  actor: sup,
  target: null,
  createdAt: '2026-10-12T10:00:00.000Z',
  ...overrides,
});

describe('describeEvent', () => {
  it('ASSIGNED por un supervisor', () => {
    expect(describeEvent(event({ type: 'ASSIGNED', actor: sup, target: laura }))).toBe(
      'Sup. Demo asignó la conversación a Laura',
    );
  });

  it('ASSIGNED a uno mismo se lee como "tomó"', () => {
    expect(describeEvent(event({ type: 'ASSIGNED', actor: laura, target: laura }))).toBe(
      'Laura tomó la conversación',
    );
  });

  it('RELEASED, CLOSED y REOPENED', () => {
    expect(describeEvent(event({ type: 'RELEASED', actor: laura }))).toBe(
      'Laura liberó la conversación a la IA',
    );
    expect(describeEvent(event({ type: 'CLOSED', actor: mateo }))).toBe('Cerrada por Mateo');
    expect(describeEvent(event({ type: 'REOPENED', actor: sup }))).toBe('Reabierta por Sup. Demo');
  });

  it('REOPENED sin actor es la reapertura por un mensaje del cliente', () => {
    expect(describeEvent(event({ type: 'REOPENED', actor: null }))).toBe(
      'Reabierta por un mensaje del cliente',
    );
  });
});

describe('statusLabel', () => {
  it('IA activa, Asignada a … y Cerrada', () => {
    expect(statusLabel({ status: 'OPEN', aiActive: true, assignedAgent: null })).toBe('IA activa');
    expect(statusLabel({ status: 'OPEN', aiActive: false, assignedAgent: laura })).toBe(
      'Asignada a Laura',
    );
    expect(statusLabel({ status: 'CLOSED', aiActive: false, assignedAgent: laura })).toBe(
      'Cerrada',
    );
  });
});
