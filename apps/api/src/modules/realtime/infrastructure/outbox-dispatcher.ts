import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RealtimeEventSchema } from '@omnidesk/contracts';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  OUTBOX_EVENT_STORE,
  type OutboxEventStore,
  type PendingOutboxEvent,
} from '../application/ports/outbox-event-store';
import {
  REALTIME_PUBLISHER,
  type RealtimePublisher,
} from '../application/ports/realtime-publisher';

export const DISPATCH_INTERVAL_MS = 500;
export const BATCH_SIZE = 100;
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const PUBLISHED_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Tope del backoff `2^attempts` s: evita fechas inválidas si un evento falla muchas veces. */
const MAX_BACKOFF_SECONDS = 60 * 60;

/** Publica los eventos del Outbox (arquitectura §3): lee cada 500 ms y limpia los publicados cada hora. */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private dispatchTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private running: Promise<unknown> = Promise.resolve();
  private busy = false;

  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(OUTBOX_EVENT_STORE) private readonly store: OutboxEventStore,
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
  ) {}

  onApplicationBootstrap(): void {
    this.dispatchTimer = setInterval(() => this.schedule(() => this.tick()), DISPATCH_INTERVAL_MS);
    this.cleanupTimer = setInterval(() => this.schedule(() => this.cleanup()), CLEANUP_INTERVAL_MS);
    this.dispatchTimer.unref();
    this.cleanupTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.dispatchTimer);
    clearInterval(this.cleanupTimer);
    await this.running;
  }

  /** Procesa un lote. Devuelve cuántos eventos se publicaron. */
  async tick(now: Date = new Date()): Promise<number> {
    return this.tx.run(async () => {
      const events = await this.store.lockPending(BATCH_SIZE, now);
      if (events.length === BATCH_SIZE) {
        this.logger.warn(`Lote lleno (${BATCH_SIZE}): el dispatcher puede estar atrasado`);
      }
      let published = 0;
      for (const event of events) {
        if (await this.dispatch(event, now)) published += 1;
      }
      return published;
    });
  }

  /** Borra los eventos publicados hace más de 24 h. */
  async cleanup(now: Date = new Date()): Promise<number> {
    const deleted = await this.store.deletePublishedBefore(
      new Date(now.getTime() - PUBLISHED_RETENTION_MS),
    );
    if (deleted > 0) this.logger.log(`Outbox: ${deleted} eventos publicados borrados`);
    return deleted;
  }

  private async dispatch(event: PendingOutboxEvent, now: Date): Promise<boolean> {
    try {
      this.publish(event);
      await this.store.markPublished(event.id, now);
      return true;
    } catch (error) {
      const attempts = event.attempts + 1;
      const delaySeconds = Math.min(2 ** attempts, MAX_BACKOFF_SECONDS);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Outbox ${event.id}: intento ${attempts} fallido: ${message}`);
      await this.store.scheduleRetry(event.id, {
        attempts,
        error: message,
        at: new Date(now.getTime() + delaySeconds * 1000),
      });
      return false;
    }
  }

  private publish(event: PendingOutboxEvent): void {
    if (event.type !== 'conversation.changed') {
      throw new Error(`Tipo de evento no soportado: ${event.type}`);
    }
    this.publisher.publish(event.tenantId, RealtimeEventSchema.parse(event.payload));
  }

  /** Ejecuta `work` sin solaparse con otra ejecución en curso; los errores se registran. */
  private schedule(work: () => Promise<unknown>): void {
    if (this.busy) return;
    this.busy = true;
    this.running = work()
      .catch((error: unknown) => this.logger.error(`Outbox: ${String(error)}`))
      .finally(() => {
        this.busy = false;
      });
  }
}
