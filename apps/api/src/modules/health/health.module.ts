import { Module } from '@nestjs/common';
import { DATABASE_HEALTH_PORT } from './application/ports/database-health.port';
import { CheckHealthUseCase } from './application/check-health.use-case';
import { HealthController } from './infrastructure/http/health.controller';
import { PrismaDatabaseHealthAdapter } from './infrastructure/prisma-database-health.adapter';

/** Plantilla de referencia de un módulo hexagonal: el puerto se enlaza aquí con su adaptador. */
@Module({
  controllers: [HealthController],
  providers: [
    CheckHealthUseCase,
    { provide: DATABASE_HEALTH_PORT, useClass: PrismaDatabaseHealthAdapter },
  ],
})
export class HealthModule {}
