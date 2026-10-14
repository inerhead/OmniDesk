import type { TimelineItem } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { dayLabel, groupConsecutiveBubbles, groupTimelineByDay } from './group-timeline';

const now = new Date(2026, 9, 12, 18, 30); // lunes 12/10/2026

let sequence = 0;
const laura = { id: '0199c0de-0000-7000-8000-00000000000a', displayName: 'Laura' };
const mateo = { id: '0199c0de-0000-7000-8000-00000000000b', displayName: 'Mateo' };

function message(
  at: Date,
  senderType: 'CUSTOMER' | 'AI' | 'AGENT' = 'CUSTOMER',
  sender: { id: string; displayName: string } | null = null,
): TimelineItem {
  sequence += 1;
  return {
    kind: 'message',
    id: `m${sequence}`,
    sequence,
    direction: senderType === 'CUSTOMER' ? 'INBOUND' : 'OUTBOUND',
    senderType,
    text: 'hola',
    status: senderType === 'CUSTOMER' ? 'RECEIVED' : 'SENT',
    sender,
    failureReason: null,
    attachment: null,
    createdAt: at.toISOString(),
  };
}

function event(at: Date): TimelineItem {
  sequence += 1;
  return {
    kind: 'event',
    id: `e${sequence}`,
    sequence,
    type: 'ASSIGNED',
    actor: laura,
    target: laura,
    createdAt: at.toISOString(),
  };
}

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

describe('dayLabel', () => {
  it('muestra "Hoy", "Ayer" o la fecha larga', () => {
    expect(dayLabel(at(12, 9), now)).toBe('Hoy');
    expect(dayLabel(at(11, 23, 59), now)).toBe('Ayer');
    expect(dayLabel(at(5, 10), now)).toBe('lunes, 5 de octubre');
  });

  it('añade el año si no es el actual', () => {
    expect(dayLabel(new Date(2025, 11, 31, 10), now)).toBe('miércoles, 31 de diciembre de 2025');
  });
});

describe('groupTimelineByDay', () => {
  it('agrupa por día en orden, con los separadores "Hoy" y "Ayer"', () => {
    const items = [message(at(10, 9)), message(at(11, 9)), event(at(11, 10)), message(at(12, 8))];

    const groups = groupTimelineByDay(items, now);

    expect(groups.map((group) => group.dayLabel)).toEqual(['sábado, 10 de octubre', 'Ayer', 'Hoy']);
    expect(groups.map((group) => group.items.length)).toEqual([1, 2, 1]);
  });

  it('sin elementos no hay grupos', () => {
    expect(groupTimelineByDay([], now)).toEqual([]);
  });
});

describe('groupConsecutiveBubbles', () => {
  const flags = (items: TimelineItem[]) =>
    groupConsecutiveBubbles(items).map(({ showAuthor, isLastOfGroup }) => [
      showAuthor,
      isLastOfGroup,
    ]);

  it('tres mensajes del cliente en menos de 5 min comparten un solo encabezado', () => {
    const items = [message(at(12, 9, 0)), message(at(12, 9, 2)), message(at(12, 9, 4))];

    expect(flags(items)).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  it('5 min o más entre mensajes abre un grupo nuevo', () => {
    const items = [message(at(12, 9, 0)), message(at(12, 9, 5))];

    expect(flags(items)).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it('cambiar de emisor (incluido otro agente) abre un grupo nuevo', () => {
    const items = [
      message(at(12, 9, 0), 'AI'),
      message(at(12, 9, 1), 'AGENT', laura),
      message(at(12, 9, 2), 'AGENT', laura),
      message(at(12, 9, 3), 'AGENT', mateo),
    ];

    expect(flags(items)).toEqual([
      [true, true],
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it('un evento corta el grupo y no lleva encabezado', () => {
    const items = [message(at(12, 9, 0)), event(at(12, 9, 1)), message(at(12, 9, 2))];

    expect(flags(items)).toEqual([
      [true, true],
      [false, true],
      [true, true],
    ]);
  });
});
