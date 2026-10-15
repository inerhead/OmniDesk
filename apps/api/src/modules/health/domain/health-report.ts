export type ComponentState = 'up' | 'down';

/** Estado del Outbox (SPEC 11). Informa, pero no cambia el código HTTP de `/health`. */
export type OutboxState = 'ok' | 'lagging' | 'unknown';

export interface HealthReport {
  status: 'ok' | 'error';
  checks: { database: ComponentState };
  outbox: OutboxState;
  checkedAt: Date;
}

/**
 * `lagging` si el evento pendiente más antiguo lleva más de `thresholdSeconds` esperando; `unknown`
 * si no se pudo leer (`oldestPending === undefined`).
 */
export function outboxState(
  oldestPending: Date | null | undefined,
  now: Date,
  thresholdSeconds: number,
): OutboxState {
  if (oldestPending === undefined) return 'unknown';
  if (oldestPending === null) return 'ok';
  return now.getTime() - oldestPending.getTime() > thresholdSeconds * 1000 ? 'lagging' : 'ok';
}

/**
 * Regla de dominio: el sistema está `ok` solo si la base de datos está `up`. Un Outbox atrasado no
 * lo cambia: reiniciar el API no lo arregla y cortaría los sockets.
 */
export function buildHealthReport(
  databaseUp: boolean,
  outbox: OutboxState,
  now: Date,
): HealthReport {
  return {
    status: databaseUp ? 'ok' : 'error',
    checks: { database: databaseUp ? 'up' : 'down' },
    outbox,
    checkedAt: now,
  };
}
