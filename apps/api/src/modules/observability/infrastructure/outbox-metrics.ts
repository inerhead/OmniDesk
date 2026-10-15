import { Inject, Injectable, Logger } from '@nestjs/common';
import { Gauge } from 'prom-client';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import {
  OUTBOX_BACKLOG,
  type OutboxBacklog,
} from '../../../shared/application/outbox-backlog.port';
import { METRICS_PREFIX, MetricsRegistry } from './metrics-registry';

/**
 * Gauges del Outbox (SPEC 11), calculados al leer `/metrics` (`collect`): sin consultas periódicas y
 * siempre exactos. Si la consulta falla, se omiten en esa lectura.
 */
@Injectable()
export class OutboxMetrics {
  private readonly logger = new Logger(OutboxMetrics.name);

  constructor(
    { registry }: MetricsRegistry,
    @Inject(OUTBOX_BACKLOG) backlog: OutboxBacklog,
    @Inject(CLOCK) clock: Clock,
  ) {
    const logger = this.logger;
    new Gauge({
      name: `${METRICS_PREFIX}outbox_pending_events`,
      help: 'Eventos del Outbox sin publicar, por tipo.',
      labelNames: ['type'],
      registers: [registry],
      async collect() {
        try {
          const rows = await backlog.pendingByType();
          // Sin reset, un tipo que se vació seguiría con su último valor.
          this.reset();
          for (const row of rows) this.set({ type: row.type }, row.count);
        } catch (error) {
          logger.warn(`No se pudo leer el Outbox para las métricas: ${String(error)}`);
        }
      },
    });
    new Gauge({
      name: `${METRICS_PREFIX}outbox_oldest_pending_age_seconds`,
      help: 'Antigüedad del evento del Outbox sin publicar más antiguo (0 si no hay).',
      registers: [registry],
      async collect() {
        try {
          const oldest = await backlog.oldestPendingCreatedAt();
          this.set(oldest ? Math.max(0, (clock.now().getTime() - oldest.getTime()) / 1000) : 0);
        } catch (error) {
          logger.warn(`No se pudo leer el Outbox para las métricas: ${String(error)}`);
        }
      },
    });
  }
}
