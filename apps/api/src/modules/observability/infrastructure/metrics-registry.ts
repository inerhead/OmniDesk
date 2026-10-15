import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';

/** Prefijo de todas las métricas de OmniDesk (SPEC 11). */
export const METRICS_PREFIX = 'omnidesk_';

/**
 * Registro de métricas Prometheus de esta instancia del API, con las métricas por defecto de
 * proceso y Node (CPU, memoria, event loop, GC). Uno por aplicación, no el global de `prom-client`:
 * las pruebas levantan varias en el mismo proceso.
 */
@Injectable()
export class MetricsRegistry {
  readonly registry = new Registry();

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: METRICS_PREFIX });
  }
}
