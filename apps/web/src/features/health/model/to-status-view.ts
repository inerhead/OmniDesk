import type { HealthResponse } from '@omnidesk/contracts';

export type StatusView =
  | { kind: 'ok'; label: 'API: ok · DB: ok' }
  | { kind: 'db-down'; label: 'API: ok · DB: down' }
  | { kind: 'api-down'; label: 'API: no disponible' }
  | { kind: 'offline'; label: 'Sin conexión' };

/**
 * @param health respuesta del API, o `null` si el API no respondió.
 * @param online `navigator.onLine`.
 */
export function toStatusView(health: HealthResponse | null, online: boolean): StatusView {
  if (!online) return { kind: 'offline', label: 'Sin conexión' };
  if (health === null) return { kind: 'api-down', label: 'API: no disponible' };
  if (health.status === 'ok' && health.checks.database === 'up') {
    return { kind: 'ok', label: 'API: ok · DB: ok' };
  }
  return { kind: 'db-down', label: 'API: ok · DB: down' };
}
