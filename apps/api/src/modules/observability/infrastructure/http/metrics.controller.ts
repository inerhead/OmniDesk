import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsRegistry } from '../metrics-registry';
import { MetricsTokenGuard } from './metrics-token.guard';

/**
 * Métricas Prometheus (SPEC 11). Solo se registra con `METRICS_TOKEN`, y el gateway de producción
 * la bloquea: se consulta desde el VPS o la red interna de Compose.
 */
@ApiExcludeController()
@UseGuards(MetricsTokenGuard)
@Controller({ path: 'metrics', version: '1' })
export class MetricsController {
  constructor(private readonly metrics: MetricsRegistry) {}

  @Get()
  async get(@Res() res: Response): Promise<void> {
    const { registry } = this.metrics;
    res.type(registry.contentType).send(await registry.metrics());
  }
}
