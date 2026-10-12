import { describe, expect, it } from 'vitest';
import { composerMode } from './composer-mode';

const laura = { id: 'laura', role: 'AGENT' as const };
const owner = { id: 'owner', role: 'OWNER' as const };

describe('composerMode', () => {
  it('el agente asignado ve el composer', () => {
    expect(
      composerMode({ status: 'OPEN', assignedAgent: { id: 'laura', displayName: 'Laura' } }, laura),
    ).toEqual({ kind: 'compose' });
  });

  it('con la IA atendiendo, el actor puede tomar la conversación', () => {
    expect(composerMode({ status: 'OPEN', assignedAgent: null }, laura)).toEqual({ kind: 'take' });
    expect(composerMode({ status: 'OPEN', assignedAgent: null }, owner)).toEqual({ kind: 'take' });
  });

  it('asignada a otro: muestra su nombre, también a un supervisor', () => {
    const mateo = { id: 'mateo', displayName: 'Mateo' };

    expect(composerMode({ status: 'OPEN', assignedAgent: mateo }, owner)).toEqual({
      kind: 'assigned-other',
      name: 'Mateo',
    });
    expect(composerMode({ status: 'OPEN', assignedAgent: mateo }, laura)).toEqual({
      kind: 'assigned-other',
      name: 'Mateo',
    });
  });

  it('en una conversación cerrada no hay nada', () => {
    expect(
      composerMode(
        { status: 'CLOSED', assignedAgent: { id: 'laura', displayName: 'Laura' } },
        laura,
      ),
    ).toEqual({ kind: 'none' });
    expect(composerMode({ status: 'CLOSED', assignedAgent: null }, laura)).toEqual({
      kind: 'none',
    });
  });
});
