import { InboxSchema, type Inbox, type MemberRole } from '@omnidesk/contracts';

export const INBOX_LABEL: Record<Inbox, string> = {
  ai: 'Sin asignar',
  mine: 'Mías',
  all: 'Todas',
  closed: 'Cerradas',
};

const ORDER: Inbox[] = ['ai', 'mine', 'all', 'closed'];

/** Pestañas que ve el rol: todos los roles ven las cuatro (SPEC 21). */
export function visibleInboxes(_role: MemberRole): Inbox[] {
  return ORDER;
}

/** La bandeja de `?inbox=`; si falta, es inválida o el rol no puede verla, la de la IA. */
export function parseInbox(param: string | null, role: MemberRole): Inbox {
  const parsed = InboxSchema.safeParse(param);
  return parsed.success && visibleInboxes(role).includes(parsed.data) ? parsed.data : 'ai';
}

export const EMPTY_INBOX_MESSAGE: Record<Inbox, string> = {
  ai: 'No hay conversaciones sin asignar.',
  mine: 'No tienes conversaciones asignadas.',
  all: 'No hay conversaciones abiertas.',
  closed: 'No hay conversaciones cerradas.',
};

/** Texto del contador de una pestaña: nada en 0 (o sin dato) y "99+" a partir de 100. */
export function formatInboxCount(count: number | undefined): string | null {
  if (!count) return null;
  return count > 99 ? '99+' : String(count);
}
