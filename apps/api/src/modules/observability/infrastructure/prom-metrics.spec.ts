import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics-registry';
import { PromMetrics } from './prom-metrics';

describe('PromMetrics', () => {
  it('registra todos los contadores con prefijo, aunque aún valgan 0', async () => {
    const registry = new MetricsRegistry();
    new PromMetrics(registry);
    const text = await registry.registry.metrics();
    for (const name of [
      'omnidesk_http_request_duration_seconds',
      'omnidesk_realtime_connected_sockets',
      'omnidesk_message_send_attempts_total',
      'omnidesk_messages_failed_total',
      'omnidesk_delivery_status_updates_total',
      'omnidesk_integration_requests_total',
      'omnidesk_rate_limit_rejections_total',
      'omnidesk_rate_limit_store_errors_total',
    ]) {
      expect(text, name).toContain(`# TYPE ${name}`);
    }
  });

  it('cuenta con las etiquetas acotadas', async () => {
    const registry = new MetricsRegistry();
    const metrics = new PromMetrics(registry);
    metrics.messageSendAttempt('SIMULATED', 'failure');
    metrics.messageSendAttempt('SIMULATED', 'failure');
    metrics.deliveryStatusUpdate('DELIVERED', false);
    metrics.integrationRequest('inbound', 'invalid_signature');
    const text = await registry.registry.metrics();
    expect(text).toContain(
      'omnidesk_message_send_attempts_total{provider="SIMULATED",result="failure"} 2',
    );
    expect(text).toContain(
      'omnidesk_delivery_status_updates_total{status="DELIVERED",applied="false"} 1',
    );
    expect(text).toContain(
      'omnidesk_integration_requests_total{endpoint="inbound",result="invalid_signature"} 1',
    );
  });
});
