import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import { conversationSearch, inboxFilter } from './inbox-filter';

const owner: ActorContext = { userId: 'u-owner', tenantId: 't1', memberId: 'owner', role: 'OWNER' };
const laura: ActorContext = { userId: 'u-laura', tenantId: 't1', memberId: 'laura', role: 'AGENT' };

describe('inboxFilter', () => {
  it('ai: abiertas sin agente, para cualquier rol', () => {
    const expected = { status: 'OPEN', assignedAgentId: null };
    expect(inboxFilter(owner, 'ai')).toEqual(expected);
    expect(inboxFilter(laura, 'ai')).toEqual(expected);
  });

  it('mine: abiertas asignadas al actor', () => {
    expect(inboxFilter(laura, 'mine')).toEqual({ status: 'OPEN', assignedAgentId: 'laura' });
    expect(inboxFilter(owner, 'mine')).toEqual({ status: 'OPEN', assignedAgentId: 'owner' });
  });

  it('all: todas las abiertas, para cualquier rol (SPEC 21)', () => {
    expect(inboxFilter(owner, 'all')).toEqual({ status: 'OPEN' });
    expect(inboxFilter({ ...owner, role: 'ADMIN' }, 'all')).toEqual({ status: 'OPEN' });
    expect(inboxFilter(laura, 'all')).toEqual({ status: 'OPEN' });
  });

  it('channelId se combina con la bandeja', () => {
    expect(inboxFilter(laura, 'ai', undefined, 'canal-1')).toEqual({
      status: 'OPEN',
      assignedAgentId: null,
      channelId: 'canal-1',
    });
  });

  it('closed: todas las cerradas, para cualquier rol (SPEC 21)', () => {
    expect(inboxFilter(owner, 'closed')).toEqual({ status: 'CLOSED' });
    expect(inboxFilter(laura, 'closed')).toEqual({ status: 'CLOSED' });
  });
});

describe('conversationSearch', () => {
  it('sin q o vacío no filtra', () => {
    expect(conversationSearch(undefined)).toBeUndefined();
    expect(conversationSearch('   ')).toBeUndefined();
  });

  it('un término sin dígitos busca solo por nombre', () => {
    expect(conversationSearch(' jua ')).toEqual({ name: 'jua' });
  });

  it('3 dígitos o más tras quitar espacios, +, - y paréntesis buscan también por teléfono', () => {
    expect(conversationSearch('300 123')).toEqual({ name: '300 123', phoneDigits: '300123' });
    expect(conversationSearch('+57 (300)-123')).toEqual({
      name: '+57 (300)-123',
      phoneDigits: '57300123',
    });
  });

  it('menos de 3 dígitos no busca por teléfono', () => {
    expect(conversationSearch('ana 12')).toEqual({ name: 'ana 12' });
  });
});

describe('inboxFilter con q', () => {
  it('combina la búsqueda con la bandeja', () => {
    expect(inboxFilter(laura, 'closed', 'jua')).toEqual({
      status: 'CLOSED',
      search: { name: 'jua' },
    });
    expect(inboxFilter(laura, 'all', 'jua')).toEqual({ status: 'OPEN', search: { name: 'jua' } });
  });
});
