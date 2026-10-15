import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import type {
  IntegrationEndpoint,
  IntegrationResult,
  Metrics,
} from '../../../shared/application/metrics.port';
import { METRICS_PREFIX, MetricsRegistry } from './metrics-registry';

/**
 * Adaptador `prom-client` del puerto `Metrics` (SPEC 11). También expone los instrumentos que solo
 * usa la infraestructura: el histograma HTTP y el gauge de sockets.
 */
@Injectable()
export class PromMetrics implements Metrics {
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status_class'>;
  readonly realtimeConnectedSockets: Gauge;
  private readonly sendAttempts: Counter<'provider' | 'result'>;
  private readonly messagesFailed: Counter<'provider'>;
  private readonly deliveryUpdates: Counter<'status' | 'applied'>;
  private readonly integrationRequests: Counter<'endpoint' | 'result'>;
  private readonly rateLimitRejections: Counter<'policy'>;
  private readonly rateLimitStoreErrors: Counter;

  constructor({ registry }: MetricsRegistry) {
    const registers = [registry];
    this.httpRequestDuration = new Histogram({
      name: `${METRICS_PREFIX}http_request_duration_seconds`,
      help: 'Latencia de las peticiones HTTP, por ruta de plantilla.',
      labelNames: ['method', 'route', 'status_class'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers,
    });
    this.realtimeConnectedSockets = new Gauge({
      name: `${METRICS_PREFIX}realtime_connected_sockets`,
      help: 'Sockets de tiempo real conectados (con sesión y empresa).',
      registers,
    });
    this.sendAttempts = new Counter({
      name: `${METRICS_PREFIX}message_send_attempts_total`,
      help: 'Intentos de envío de mensajes salientes al proveedor.',
      labelNames: ['provider', 'result'],
      registers,
    });
    this.messagesFailed = new Counter({
      name: `${METRICS_PREFIX}messages_failed_total`,
      help: 'Mensajes salientes que pasan a FAILED.',
      labelNames: ['provider'],
      registers,
    });
    this.deliveryUpdates = new Counter({
      name: `${METRICS_PREFIX}delivery_status_updates_total`,
      help: 'Reportes de estado de entrega recibidos de las integraciones.',
      labelNames: ['status', 'applied'],
      registers,
    });
    this.integrationRequests = new Counter({
      name: `${METRICS_PREFIX}integration_requests_total`,
      help: 'Peticiones a los endpoints de integración.',
      labelNames: ['endpoint', 'result'],
      registers,
    });
    this.rateLimitRejections = new Counter({
      name: `${METRICS_PREFIX}rate_limit_rejections_total`,
      help: 'Respuestas 429 por política de rate limiting.',
      labelNames: ['policy'],
      registers,
    });
    this.rateLimitStoreErrors = new Counter({
      name: `${METRICS_PREFIX}rate_limit_store_errors_total`,
      help: 'Fallos del contador de rate limiting (se deja pasar la petición).',
      registers,
    });
  }

  messageSendAttempt(provider: string, result: 'success' | 'failure'): void {
    this.sendAttempts.inc({ provider, result });
  }

  messageFailed(provider: string): void {
    this.messagesFailed.inc({ provider });
  }

  deliveryStatusUpdate(status: string, applied: boolean): void {
    this.deliveryUpdates.inc({ status, applied: String(applied) });
  }

  integrationRequest(endpoint: IntegrationEndpoint, result: IntegrationResult): void {
    this.integrationRequests.inc({ endpoint, result });
  }

  rateLimitRejected(policy: string): void {
    this.rateLimitRejections.inc({ policy });
  }

  rateLimitStoreError(): void {
    this.rateLimitStoreErrors.inc();
  }
}
