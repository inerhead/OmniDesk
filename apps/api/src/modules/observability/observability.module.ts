import { type DynamicModule, Global, Module } from '@nestjs/common';
import { METRICS } from '../../shared/application/metrics.port';
import type { Env } from '../../shared/config/env';
import { MetricsController } from './infrastructure/http/metrics.controller';
import { MetricsTokenGuard } from './infrastructure/http/metrics-token.guard';
import { MetricsRegistry } from './infrastructure/metrics-registry';
import { OutboxMetrics } from './infrastructure/outbox-metrics';
import { PromMetrics } from './infrastructure/prom-metrics';

/** Métricas Prometheus (SPEC 11). Sin `METRICS_TOKEN`, `GET /api/v1/metrics` no existe. */
@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ObservabilityModule,
      controllers: env.METRICS_TOKEN ? [MetricsController] : [],
      providers: [
        MetricsRegistry,
        MetricsTokenGuard,
        PromMetrics,
        OutboxMetrics,
        { provide: METRICS, useExisting: PromMetrics },
      ],
      exports: [MetricsRegistry, PromMetrics, METRICS],
    };
  }
}
