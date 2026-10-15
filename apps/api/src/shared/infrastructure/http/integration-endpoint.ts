import type { IntegrationEndpoint } from '../../application/metrics.port';

/** Endpoint de integración de una ruta `/api/v1/integrations/messages/<endpoint>` (SPEC 11). */
export function integrationEndpoint(path: string): IntegrationEndpoint | null {
  const last = path.replace(/\/+$/, '').split('/').pop();
  return last === 'inbound' || last === 'outbound' || last === 'status' ? last : null;
}
