import type { Inbox } from '@omnidesk/contracts';
import type { ActorContext } from '../../../shared/application/request-context';
import { canViewInbox, isManager } from '../domain/conversation-policy';
import type { ConversationFilter } from './ports/conversation-read-model';

export class InboxForbiddenError extends Error {
  constructor() {
    super('Tu rol no puede ver esta bandeja');
    this.name = 'InboxForbiddenError';
  }
}

/**
 * Filtro de cada bandeja (docs/specs/04). Lanza `InboxForbiddenError` si el rol no puede verla.
 * - ai: abiertas sin agente · mine: abiertas asignadas al actor · all: abiertas (OWNER/ADMIN)
 * - closed: cerradas; un AGENT solo las que tienen su `assignedAgentId`.
 */
export function inboxFilter(actor: ActorContext, inbox: Inbox): ConversationFilter {
  if (!canViewInbox(actor, inbox)) throw new InboxForbiddenError();

  switch (inbox) {
    case 'ai':
      return { status: 'OPEN', assignedAgentId: null };
    case 'mine':
      return { status: 'OPEN', assignedAgentId: actor.memberId };
    case 'all':
      return { status: 'OPEN' };
    case 'closed':
      return isManager(actor.role)
        ? { status: 'CLOSED' }
        : { status: 'CLOSED', assignedAgentId: actor.memberId };
  }
}
