import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { UpdateDeliveryStatusUseCase } from '../../conversations/application/update-delivery-status.use-case';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { ENV, type Env } from '../../../shared/config/env';
import type {
  MessagingProvider,
  SendMessageRequest,
} from '../application/ports/messaging-provider.port';

export const SIMULATED_DELIVERED_AFTER_MS = 1_500;
export const SIMULATED_READ_AFTER_MS = 4_000;

/**
 * Proveedor simulado: falla con probabilidad `SIMULATED_PROVIDER_FAILURE_RATE` y, si no, confirma
 * `DELIVERED` (+1,5 s) y `READ` (+4 s) por el mismo caso de uso que el endpoint de estados.
 * Los estados programados viven en memoria: si el API se reinicia, el mensaje queda en `SENT`.
 */
@Injectable()
export class SimulatedMessagingProvider implements MessagingProvider, OnModuleDestroy {
  private readonly logger = new Logger(SimulatedMessagingProvider.name);
  private readonly timers = new Set<NodeJS.Timeout>();
  /** Reemplazable en las pruebas. */
  random: () => number = Math.random;

  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    private readonly deliveryStatus: UpdateDeliveryStatusUseCase,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(request: SendMessageRequest): Promise<{ providerMessageId: string }> {
    if (this.random() < this.env.SIMULATED_PROVIDER_FAILURE_RATE) {
      throw new Error('Fallo simulado del proveedor de mensajería');
    }
    // Determinista por mensaje: un reenvío tras una caída devuelve el mismo id.
    const providerMessageId = `sim-${request.messageId}`;
    this.schedule(request, providerMessageId, 'DELIVERED', SIMULATED_DELIVERED_AFTER_MS);
    this.schedule(request, providerMessageId, 'READ', SIMULATED_READ_AFTER_MS);
    return { providerMessageId };
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(
    request: SendMessageRequest,
    providerMessageId: string,
    status: 'DELIVERED' | 'READ',
    delayMs: number,
  ): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      // El temporizador nace dentro de la transacción del dispatcher: no debe heredarla.
      this.tx
        .runDetached(() =>
          this.deliveryStatus.execute(
            { tenantId: request.tenantId, channelId: request.channelId },
            { messageId: request.messageId, providerMessageId, status, occurredAt: new Date() },
          ),
        )
        .catch((error: unknown) =>
          this.logger.warn(
            `No se pudo reportar ${status} de ${request.messageId}: ${String(error)}`,
          ),
        );
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
  }
}
