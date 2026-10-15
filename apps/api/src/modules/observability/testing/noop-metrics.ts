import type {
  IntegrationEndpoint,
  IntegrationResult,
  Metrics,
} from '../../../shared/application/metrics.port';

/** `Metrics` que no registra nada; las pruebas lo espían (`vi.spyOn`) para comprobar las llamadas. */
export class NoopMetrics implements Metrics {
  messageSendAttempt(_provider: string, _result: 'success' | 'failure'): void {}
  messageFailed(_provider: string): void {}
  deliveryStatusUpdate(_status: string, _applied: boolean): void {}
  integrationRequest(_endpoint: IntegrationEndpoint, _result: IntegrationResult): void {}
  rateLimitRejected(_policy: string): void {}
  rateLimitStoreError(): void {}
}
