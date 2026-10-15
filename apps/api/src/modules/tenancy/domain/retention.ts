/** Días que una empresa puede conservar sus conversaciones cerradas (SPEC 12). */
export const RETENTION_DAYS_OPTIONS = [90, 180, 365] as const;

/** `null` = indefinidamente (por defecto). */
export type RetentionDays = (typeof RETENTION_DAYS_OPTIONS)[number] | null;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lee `tenants.retention_days`. Un valor fuera de las opciones (no debería existir: el API solo
 * escribe valores validados) cuenta como indefinido, así nunca se borra de más.
 */
export function toRetentionDays(value: number | null): RetentionDays {
  return RETENTION_DAYS_OPTIONS.find((option) => option === value) ?? null;
}

/** Las conversaciones cerradas con el último mensaje antes de este instante se borran. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
