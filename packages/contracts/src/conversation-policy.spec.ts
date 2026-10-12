import { describe, expect, it } from 'vitest';
import {
  availableCommands,
  can,
  canViewInbox,
  commandApplies,
  type PolicyAction,
  type PolicyActor,
  type PolicyConversation,
} from './conversation-policy';

const owner: PolicyActor = { memberId: 'owner', role: 'OWNER' };
const admin: PolicyActor = { memberId: 'admin', role: 'ADMIN' };
const laura: PolicyActor = { memberId: 'laura', role: 'AGENT' };

const open = (assignedAgentId: string | null): PolicyConversation => ({
  status: 'OPEN',
  assignedAgentId,
});
const closed = (assignedAgentId: string | null): PolicyConversation => ({
  status: 'CLOSED',
  assignedAgentId,
});

describe('can: OWNER y ADMIN', () => {
  const actions: PolicyAction[] = ['view', 'assign', 'release', 'close', 'reopen'];

  it.each([owner, admin])('pueden todo sobre cualquier conversación ($role)', (actor) => {
    for (const conversation of [open(null), open('laura'), open('mateo'), closed('mateo')]) {
      for (const action of actions) {
        expect(can(actor, action, conversation, 'laura')).toBe(true);
      }
    }
  });
});

describe('can: AGENT', () => {
  it('abre conversaciones sin asignar o asignadas a él, no las de otro', () => {
    expect(can(laura, 'view', open(null))).toBe(true);
    expect(can(laura, 'view', open('laura'))).toBe(true);
    expect(can(laura, 'view', open('mateo'))).toBe(false);
    expect(can(laura, 'view', closed('laura'))).toBe(true);
    expect(can(laura, 'view', closed('mateo'))).toBe(false);
  });

  it('toma una conversación solo si está sin asignar', () => {
    expect(can(laura, 'assign', open(null), 'laura')).toBe(true);
    expect(can(laura, 'assign', open('laura'), 'laura')).toBe(false);
    expect(can(laura, 'assign', open('mateo'), 'laura')).toBe(false);
  });

  it('no asigna ni reasigna a otro', () => {
    expect(can(laura, 'assign', open(null), 'mateo')).toBe(false);
    expect(can(laura, 'assign', open('laura'), 'mateo')).toBe(false);
    expect(can(laura, 'assign', open(null))).toBe(false);
  });

  it.each(['release', 'close', 'reopen'] as const)('solo hace %s sobre las suyas', (action) => {
    expect(can(laura, action, open('laura'))).toBe(true);
    expect(can(laura, action, closed('laura'))).toBe(true);
    expect(can(laura, action, open(null))).toBe(false);
    expect(can(laura, action, open('mateo'))).toBe(false);
    expect(can(laura, action, closed('mateo'))).toBe(false);
  });
});

describe('canViewInbox', () => {
  it('la bandeja all es solo de OWNER y ADMIN', () => {
    expect(canViewInbox(owner, 'all')).toBe(true);
    expect(canViewInbox(admin, 'all')).toBe(true);
    expect(canViewInbox(laura, 'all')).toBe(false);
  });

  it.each(['ai', 'mine', 'closed'] as const)('la bandeja %s es de todos', (inbox) => {
    expect(canViewInbox(laura, inbox)).toBe(true);
    expect(canViewInbox(owner, inbox)).toBe(true);
  });
});

describe('commandApplies (tabla de estados)', () => {
  it('assign solo desde OPEN y no al mismo agente', () => {
    expect(commandApplies('assign', open(null), 'laura')).toBe(true);
    expect(commandApplies('assign', open('mateo'), 'laura')).toBe(true);
    expect(commandApplies('assign', open('laura'), 'laura')).toBe(false);
    expect(commandApplies('assign', closed(null), 'laura')).toBe(false);
  });

  it('release solo desde OPEN y asignada', () => {
    expect(commandApplies('release', open('laura'))).toBe(true);
    expect(commandApplies('release', open(null))).toBe(false);
    expect(commandApplies('release', closed('laura'))).toBe(false);
  });

  it('close solo desde OPEN', () => {
    expect(commandApplies('close', open(null))).toBe(true);
    expect(commandApplies('close', open('laura'))).toBe(true);
    expect(commandApplies('close', closed('laura'))).toBe(false);
  });

  it('reopen solo desde CLOSED', () => {
    expect(commandApplies('reopen', closed('laura'))).toBe(true);
    expect(commandApplies('reopen', closed(null))).toBe(true);
    expect(commandApplies('reopen', open(null))).toBe(false);
  });
});

describe('availableCommands (botones de la web)', () => {
  it('un OWNER ve todo lo que aplica a una conversación asignada a otro', () => {
    expect(availableCommands(owner, open('laura'))).toEqual({
      take: true,
      assignOther: true,
      release: true,
      close: true,
      reopen: false,
    });
  });

  it('un OWNER solo ve "Reabrir" en una cerrada', () => {
    expect(availableCommands(owner, closed('laura'))).toEqual({
      take: false,
      assignOther: false,
      release: false,
      close: false,
      reopen: true,
    });
  });

  it('un AGENT ve "Tomar" y "Cerrar" en una conversación de la IA', () => {
    expect(availableCommands(laura, open(null))).toEqual({
      take: true,
      assignOther: false,
      release: false,
      close: false,
      reopen: false,
    });
  });

  it('un AGENT ve liberar y cerrar en la suya, y nada en la de otro', () => {
    expect(availableCommands(laura, open('laura'))).toEqual({
      take: false,
      assignOther: false,
      release: true,
      close: true,
      reopen: false,
    });
    expect(availableCommands(laura, open('mateo'))).toEqual({
      take: false,
      assignOther: false,
      release: false,
      close: false,
      reopen: false,
    });
  });
});
