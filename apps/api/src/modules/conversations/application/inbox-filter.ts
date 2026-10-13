import type { Inbox } from '@omnidesk/contracts';
import type { ActorContext } from '../../../shared/application/request-context';
import { canViewInbox, isManager } from '../domain/conversation-policy';
import type { ConversationFilter, ConversationSearch } from './ports/conversation-read-model';

export class InboxForbiddenError extends Error {
  constructor() {
    super('Tu rol no puede ver esta bandeja');
    this.name = 'InboxForbiddenError';
  }
}

/**
 * Búsqueda de la bandeja (docs/specs/06): por nombre y, si `q` tiene 3 dígitos o más tras quitar
 * espacios, `+`, `-` y paréntesis, también por teléfono con esos dígitos. `q` vacío = sin filtro.
 */
export function conversationSearch(q: string | undefined): ConversationSearch | undefined {
  const name = q?.trim();
  if (!name) return undefined;
  const digits = name.replace(/\D/g, '');
  return digits.length >= 3 ? { name, phoneDigits: digits } : { name };
}

/**
 * Filtro de cada bandeja (docs/specs/04). Lanza `InboxForbiddenError` si el rol no puede verla.
 * - ai: abiertas sin agente · mine: abiertas asignadas al actor · all: abiertas (OWNER/ADMIN)
 * - closed: cerradas; un AGENT solo las que tienen su `assignedAgentId`.
 * `q` y `channelId` se combinan con `AND` con la bandeja y los permisos.
 */
export function inboxFilter(
  actor: ActorContext,
  inbox: Inbox,
  q?: string,
  channelId?: string,
): ConversationFilter {
  if (!canViewInbox(actor, inbox)) throw new InboxForbiddenError();
  const search = conversationSearch(q);
  return {
    ...byInbox(actor, inbox),
    ...(search && { search }),
    ...(channelId && { channelId }),
  };
}

function byInbox(actor: ActorContext, inbox: Inbox): ConversationFilter {
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
