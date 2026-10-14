import { describe, expect, it } from 'vitest';
import { composerMode } from './composer-mode';

const now = new Date('2026-10-13T20:00:00.000Z');
const recent = '2026-10-13T10:00:00.000Z';
const expired = '2026-10-12T20:00:00.000Z';
const laura = { id: 'laura', role: 'AGENT' as const };
const owner = { id: 'owner', role: 'OWNER' as const };

describe('composerMode', () => {
  it('el agente asignado ve el composer', () => {
    expect(
      composerMode(
        {
          status: 'OPEN',
          assignedAgent: { id: 'laura', displayName: 'Laura', avatarUrl: null },
          lastInboundAt: recent,
        },
        laura,
        now,
      ),
    ).toEqual({ kind: 'compose' });
  });

  it('con la IA atendiendo, el actor puede tomar la conversación', () => {
    expect(
      composerMode({ status: 'OPEN', assignedAgent: null, lastInboundAt: expired }, laura, now),
    ).toEqual({ kind: 'take' });
    expect(
      composerMode({ status: 'OPEN', assignedAgent: null, lastInboundAt: null }, owner, now),
    ).toEqual({ kind: 'take' });
  });

  it('asignada a otro: muestra su nombre, también a un supervisor', () => {
    const mateo = { id: 'mateo', displayName: 'Mateo', avatarUrl: null };

    expect(
      composerMode({ status: 'OPEN', assignedAgent: mateo, lastInboundAt: recent }, owner, now),
    ).toEqual({
      kind: 'assigned-other',
      name: 'Mateo',
    });
    expect(
      composerMode({ status: 'OPEN', assignedAgent: mateo, lastInboundAt: recent }, laura, now),
    ).toEqual({
      kind: 'assigned-other',
      name: 'Mateo',
    });
  });

  it('en una conversación cerrada no hay nada', () => {
    expect(
      composerMode(
        {
          status: 'CLOSED',
          assignedAgent: { id: 'laura', displayName: 'Laura', avatarUrl: null },
          lastInboundAt: recent,
        },
        laura,
        now,
      ),
    ).toEqual({ kind: 'none' });
    expect(
      composerMode({ status: 'CLOSED', assignedAgent: null, lastInboundAt: null }, laura, now),
    ).toEqual({
      kind: 'none',
    });
  });

  it('pasadas 18 h el agente asignado no puede escribir', () => {
    expect(
      composerMode(
        {
          status: 'OPEN',
          assignedAgent: { id: 'laura', displayName: 'Laura', avatarUrl: null },
          lastInboundAt: expired,
        },
        laura,
        now,
      ),
    ).toEqual({ kind: 'window-closed' });
  });
});
