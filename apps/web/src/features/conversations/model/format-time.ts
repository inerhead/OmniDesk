const timeFormat = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const weekdayFormat = new Intl.DateTimeFormat('es', { weekday: 'short' });

/** Días de calendario entre `date` y `now` (0 = hoy, 1 = ayer). */
export function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

/**
 * Hora del último mensaje en la lista: "14:05" si es de hoy, "Ayer", el día de la semana ("lun")
 * en la última semana, o "dd/MM".
 */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = daysAgo(date, now);
  if (days <= 0) return timeFormat.format(date);
  if (days === 1) return 'Ayer';
  if (days < 7) return weekdayFormat.format(date).replace('.', '');
  // Intl con locale `es` ignora `2-digit` en el día ("3/10"): se formatea a mano.
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** Hora de una burbuja de chat: "14:05". */
export function formatMessageTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
