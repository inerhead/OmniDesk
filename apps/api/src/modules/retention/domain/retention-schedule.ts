/** El job corre a las 03:30, hora del servidor: después del backup diario de las 03:00 (SPEC 08). */
export const RETENTION_RUN_HOUR = 3;
export const RETENTION_RUN_MINUTE = 30;

/** Conversaciones por transacción: un borrado masivo no bloquea las tablas mucho tiempo. */
export const RETENTION_BATCH_SIZE = 500;

/** Las tablas técnicas (Outbox, Inbox, sesiones, invitaciones) se purgan a los 30 días. */
export const TECHNICAL_PURGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** La próxima ejecución, en hora local: hoy a las 03:30 si aún no pasó; si no, mañana. */
export function nextRetentionRunAt(now: Date): Date {
  const next = new Date(now);
  next.setHours(RETENTION_RUN_HOUR, RETENTION_RUN_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/** Las filas técnicas terminadas antes de este instante se purgan. */
export function technicalPurgeCutoff(now: Date): Date {
  return new Date(now.getTime() - TECHNICAL_PURGE_DAYS * DAY_MS);
}
