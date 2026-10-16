import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { TenantPurgeTrigger } from '../application/ports/tenant-purge-trigger';
import { TenantPurgeJob } from '../application/tenant-purge.job';
import { TENANT_PURGE_INTERVAL_MS } from '../domain/tenant-purge';

/**
 * Lanza el job de borrado de empresas (SPEC 20) al arrancar, cada minuto y cuando se pide un
 * borrado. Una sola ejecución a la vez en este proceso: si lo despiertan mientras corre, vuelve a
 * correr al terminar. Entre instancias decide el lock del job.
 */
@Injectable()
export class TenantPurgeScheduler
  implements TenantPurgeTrigger, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TenantPurgeScheduler.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> | null = null;
  private again = false;
  private stopped = false;

  constructor(private readonly job: TenantPurgeJob) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.wake(), TENANT_PURGE_INTERVAL_MS);
    this.timer.unref();
    this.wake();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }

  wake(): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.job
      .run()
      .catch((error: unknown) => this.logger.error(`Borrado de empresas fallido: ${String(error)}`))
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.wake();
        }
      });
  }
}
