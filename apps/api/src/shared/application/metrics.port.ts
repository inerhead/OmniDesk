/** Resultado de una petición de integración (n8n, simulador) para las métricas (SPEC 11). */
export type IntegrationResult = 'ok' | 'rejected' | 'unauthorized' | 'invalid_signature';

export type IntegrationEndpoint = 'inbound' | 'outbound' | 'status';

/**
 * Puerto: contadores operativos (SPEC 11). Los casos de uso no dependen de `prom-client`. Ninguna
 * etiqueta lleva ids ni datos personales: solo valores de un conjunto cerrado.
 */
export interface Metrics {
  messageSendAttempt(provider: string, result: 'success' | 'failure'): void;
  messageFailed(provider: string): void;
  deliveryStatusUpdate(status: string, applied: boolean): void;
  integrationRequest(endpoint: IntegrationEndpoint, result: IntegrationResult): void;
  /** Lo instrumenta `RateLimitGuard` (SPEC 10). */
  rateLimitRejected(policy: string): void;
  /** Lo instrumenta `RateLimitGuard` (SPEC 10). */
  rateLimitStoreError(): void;
}

export const METRICS = Symbol('METRICS');
