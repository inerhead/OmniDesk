import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { RetentionJob } from '../application/retention-job';
import { nextRetentionRunAt } from '../domain/retention-schedule';

/** Lanza la retención cada día a las 03:30, hora del servidor. Un reinicio no la ejecuta de más. */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RetentionScheduler.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly job: RetentionJob,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduleNext();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const now = this.clock.now();
    const delay = nextRetentionRunAt(now).getTime() - now.getTime();
    this.timer = setTimeout(() => {
      this.running = this.job
        .run()
        .catch((error: unknown) => this.logger.error(`Retención fallida: ${String(error)}`))
        .finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref();
  }
}
