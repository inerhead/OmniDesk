export type ComponentState = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'error';
  checks: { database: ComponentState };
  checkedAt: Date;
}

/** Regla de dominio: el sistema está `ok` solo si todas sus dependencias están `up`. */
export function buildHealthReport(databaseUp: boolean, now: Date): HealthReport {
  return {
    status: databaseUp ? 'ok' : 'error',
    checks: { database: databaseUp ? 'up' : 'down' },
    checkedAt: now,
  };
}
