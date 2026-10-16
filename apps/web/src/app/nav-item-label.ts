import type { NewMessageSignal } from '@/features/conversations/model/new-message-signal';
import type { NAV_ITEMS } from './nav-items';

export type NavItem = (typeof NAV_ITEMS)[number];

export const CONVERSATIONS = '/conversations';

/** Nombre accesible del destino: Conversaciones lo cambia mientras hay aviso (SPEC 21). */
export function navItemLabel({ to, label }: NavItem, signal: NewMessageSignal): string {
  return to === CONVERSATIONS && signal.kind === 'pending' ? `${label}, mensajes nuevos` : label;
}
