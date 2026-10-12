import { InboxSchema, canViewInbox, type Inbox, type MemberRole } from '@omnidesk/contracts';

export const INBOX_LABEL: Record<Inbox, string> = {
  ai: 'IA',
  mine: 'Mías',
  all: 'Todas',
  closed: 'Cerradas',
};

const ORDER: Inbox[] = ['ai', 'mine', 'all', 'closed'];

/** Pestañas que ve el rol: "Todas" se oculta para un AGENT. */
export function visibleInboxes(role: MemberRole): Inbox[] {
  return ORDER.filter((inbox) => canViewInbox({ memberId: '', role }, inbox));
}

/** La bandeja de `?inbox=`; si falta, es inválida o el rol no puede verla, la de la IA. */
export function parseInbox(param: string | null, role: MemberRole): Inbox {
  const parsed = InboxSchema.safeParse(param);
  return parsed.success && visibleInboxes(role).includes(parsed.data) ? parsed.data : 'ai';
}

export const EMPTY_INBOX_MESSAGE: Record<Inbox, string> = {
  ai: 'No hay conversaciones atendidas por la IA.',
  mine: 'No tienes conversaciones asignadas.',
  all: 'No hay conversaciones abiertas.',
  closed: 'No hay conversaciones cerradas.',
};
