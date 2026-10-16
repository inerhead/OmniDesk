import type { Inbox } from '@omnidesk/contracts';
import type { ActorContext } from '../../../shared/application/request-context';
import type { ConversationFilter, ConversationSearch } from './ports/conversation-read-model';

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
 * Filtro de cada bandeja (docs/specs/04). Todos los roles ven las cuatro (SPEC 21).
 * - ai: abiertas sin agente · mine: abiertas asignadas al actor · all: abiertas · closed: cerradas
 * `q` y `channelId` se combinan con `AND` con la bandeja.
 */
export function inboxFilter(
  actor: ActorContext,
  inbox: Inbox,
  q?: string,
  channelId?: string,
): ConversationFilter {
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
      return { status: 'CLOSED' };
  }
}
