import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import {
  OUTBOX_BACKLOG,
  type OutboxBacklog,
} from '../../../shared/application/outbox-backlog.port';
import { ENV, type Env } from '../../../shared/config/env';
import { buildHealthReport, outboxState, type HealthReport } from '../domain/health-report';
import { DATABASE_HEALTH_PORT, type DatabaseHealthPort } from './ports/database-health.port';

@Injectable()
export class CheckHealthUseCase {
  constructor(
    @Inject(DATABASE_HEALTH_PORT) private readonly database: DatabaseHealthPort,
    @Inject(OUTBOX_BACKLOG) private readonly outbox: OutboxBacklog,
    @Inject(ENV) private readonly env: Pick<Env, 'OUTBOX_LAG_THRESHOLD_SECONDS'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(): Promise<HealthReport> {
    const [databaseUp, oldestPending] = await Promise.all([
      this.database.ping(),
      // Si la consulta falla, el Outbox queda `unknown` y el health sigue respondiendo.
      this.outbox.oldestPendingCreatedAt().catch(() => undefined),
    ]);
    const now = this.clock.now();
    return buildHealthReport(
      databaseUp,
      outboxState(oldestPending, now, this.env.OUTBOX_LAG_THRESHOLD_SECONDS),
      now,
    );
  }
}
