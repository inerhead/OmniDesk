import { Inject, Injectable } from '@nestjs/common';
import { buildHealthReport, type HealthReport } from '../domain/health-report';
import { DATABASE_HEALTH_PORT, type DatabaseHealthPort } from './ports/database-health.port';

@Injectable()
export class CheckHealthUseCase {
  constructor(@Inject(DATABASE_HEALTH_PORT) private readonly database: DatabaseHealthPort) {}

  async execute(): Promise<HealthReport> {
    const databaseUp = await this.database.ping();
    return buildHealthReport(databaseUp, new Date());
  }
}
