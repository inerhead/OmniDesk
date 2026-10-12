const timeFormat = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Hora del último mensaje en la lista: "14:05" si es de hoy, "Ayer", o "dd/MM". */
export function formatConversationTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return timeFormat.format(date);
  if (days === 1) return 'Ayer';
  // Intl con locale `es` ignora `2-digit` en el día ("3/10"): se formatea a mano.
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** Hora de una burbuja de chat: "14:05". */
export function formatMessageTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
