import { describe, expect, it } from 'vitest';
import { decideTransition } from './conversation-transitions';

const open = (assignedAgentId: string | null = null) => ({
  status: 'OPEN' as const,
  assignedAgentId,
});
const closed = (assignedAgentId: string | null = null) => ({
  status: 'CLOSED' as const,
  assignedAgentId,
});

describe('decideTransition: assign', () => {
  it('asigna una conversación abierta sin agente', () => {
    expect(decideTransition(open(), { type: 'assign', memberId: 'laura' })).toEqual({
      ok: true,
      next: { status: 'OPEN', assignedAgentId: 'laura' },
      event: { type: 'ASSIGNED', targetMemberId: 'laura' },
    });
  });

  it('reasigna una conversación ya asignada a otro', () => {
    expect(decideTransition(open('mateo'), { type: 'assign', memberId: 'laura' })).toMatchObject({
      ok: true,
      next: { assignedAgentId: 'laura' },
    });
  });

  it('rechaza asignar al mismo agente o una conversación cerrada', () => {
    const command = { type: 'assign', memberId: 'laura' } as const;
    expect(decideTransition(open('laura'), command)).toEqual({
      ok: false,
      reason: 'INVALID_STATE',
    });
    expect(decideTransition(closed(), command)).toEqual({ ok: false, reason: 'INVALID_STATE' });
  });
});

describe('decideTransition: release', () => {
  it('devuelve a la IA una conversación asignada', () => {
    expect(decideTransition(open('laura'), { type: 'release' })).toEqual({
      ok: true,
      next: { status: 'OPEN', assignedAgentId: null },
      event: { type: 'RELEASED', targetMemberId: null },
    });
  });

  it('rechaza liberar una conversación sin agente o cerrada', () => {
    expect(decideTransition(open(), { type: 'release' })).toEqual({
      ok: false,
      reason: 'INVALID_STATE',
    });
    expect(decideTransition(closed('laura'), { type: 'release' })).toEqual({
      ok: false,
      reason: 'INVALID_STATE',
    });
  });
});

describe('decideTransition: close', () => {
  it('cierra conservando el agente asignado', () => {
    expect(decideTransition(open('laura'), { type: 'close' })).toEqual({
      ok: true,
      next: { status: 'CLOSED', assignedAgentId: 'laura' },
      event: { type: 'CLOSED', targetMemberId: null },
    });
  });

  it('cierra una conversación de la IA', () => {
    expect(decideTransition(open(), { type: 'close' })).toMatchObject({
      ok: true,
      next: { status: 'CLOSED', assignedAgentId: null },
    });
  });

  it('rechaza cerrar una conversación ya cerrada', () => {
    expect(decideTransition(closed('laura'), { type: 'close' })).toEqual({
      ok: false,
      reason: 'INVALID_STATE',
    });
  });
});

describe('decideTransition: reopen', () => {
  it('reabre una cerrada, la devuelve a la IA y quita el agente', () => {
    expect(decideTransition(closed('laura'), { type: 'reopen' })).toEqual({
      ok: true,
      next: { status: 'OPEN', assignedAgentId: null },
      event: { type: 'REOPENED', targetMemberId: null },
    });
  });

  it('rechaza reabrir una conversación abierta', () => {
    expect(decideTransition(open('laura'), { type: 'reopen' })).toEqual({
      ok: false,
      reason: 'INVALID_STATE',
    });
  });
});
