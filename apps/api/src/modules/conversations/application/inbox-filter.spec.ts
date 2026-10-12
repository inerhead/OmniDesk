import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import { InboxForbiddenError, inboxFilter } from './inbox-filter';

const owner: ActorContext = { tenantId: 't1', memberId: 'owner', role: 'OWNER' };
const laura: ActorContext = { tenantId: 't1', memberId: 'laura', role: 'AGENT' };

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

  it('all: todas las abiertas para OWNER/ADMIN y prohibida para AGENT', () => {
    expect(inboxFilter(owner, 'all')).toEqual({ status: 'OPEN' });
    expect(inboxFilter({ ...owner, role: 'ADMIN' }, 'all')).toEqual({ status: 'OPEN' });
    expect(() => inboxFilter(laura, 'all')).toThrow(InboxForbiddenError);
  });

  it('closed: todas las cerradas para OWNER/ADMIN y solo las suyas para un AGENT', () => {
    expect(inboxFilter(owner, 'closed')).toEqual({ status: 'CLOSED' });
    expect(inboxFilter(laura, 'closed')).toEqual({ status: 'CLOSED', assignedAgentId: 'laura' });
  });
});
