import type { TimelineItem } from '@omnidesk/contracts';
import { daysAgo } from './format-time';

/** Mensajes consecutivos del mismo emisor separados por menos de esto comparten encabezado. */
export const BUBBLE_GROUP_GAP_MS = 5 * 60 * 1000;

const longDayFormat = new Intl.DateTimeFormat('es', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const longDayWithYearFormat = new Intl.DateTimeFormat('es', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Separador de día del historial: "Hoy", "Ayer" o "lunes, 12 de octubre" (con año si no es el actual). */
export function dayLabel(date: Date, now: Date): string {
  const days = daysAgo(date, now);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return (date.getFullYear() === now.getFullYear() ? longDayFormat : longDayWithYearFormat).format(
    date,
  );
}

/** Agrupa el historial (ya ordenado por `sequence`) por día local, en el mismo orden. */
export function groupTimelineByDay(
  items: TimelineItem[],
  now: Date,
): Array<{ dayLabel: string; items: TimelineItem[] }> {
  const groups: Array<{ dayLabel: string; items: TimelineItem[] }> = [];
  for (const item of items) {
    const label = dayLabel(new Date(item.createdAt), now);
    const last = groups.at(-1);
    if (last?.dayLabel === label) last.items.push(item);
    else groups.push({ dayLabel: label, items: [item] });
  }
  return groups;
}

/** Quién escribió un mensaje: el cliente, la IA o un agente concreto. `null` para los eventos. */
function authorKey(item: TimelineItem): string | null {
  if (item.kind === 'event') return null;
  return item.senderType === 'AGENT' ? `AGENT:${item.sender?.id ?? ''}` : item.senderType;
}

function sameGroup(previous: TimelineItem | undefined, item: TimelineItem): boolean {
  if (!previous) return false;
  const author = authorKey(item);
  return (
    author !== null &&
    author === authorKey(previous) &&
    Date.parse(item.createdAt) - Date.parse(previous.createdAt) < BUBBLE_GROUP_GAP_MS
  );
}

/**
 * Marca los grupos de burbujas: mensajes consecutivos del mismo emisor con menos de 5 min entre sí
 * comparten un encabezado de autor (`showAuthor` en el primero) y la cola visual (`isLastOfGroup`
 * en el último). Un evento corta el grupo.
 */
export function groupConsecutiveBubbles(
  items: TimelineItem[],
): Array<{ showAuthor: boolean; isLastOfGroup: boolean; item: TimelineItem }> {
  return items.map((item, index) => {
    const next = items[index + 1];
    return {
      item,
      showAuthor: item.kind === 'message' && !sameGroup(items[index - 1], item),
      isLastOfGroup: !next || !sameGroup(item, next),
    };
  });
}
