import { Inject, Injectable, Optional } from '@nestjs/common';
import { METRICS, type Metrics } from '../../../shared/application/metrics.port';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import type { IntegrationContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { canTransitionDelivery, type DeliveryStatus } from '../domain/delivery';
import type { MessageStatus } from '../domain/message';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import { EVENT_INBOX, type EventInbox } from './ports/event-inbox';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

export interface DeliveryStatusInput {
  messageId: string;
  /** Ausente cuando el API marca `FAILED` sin haber llegado al proveedor. */
  providerMessageId?: string;
  status: DeliveryStatus;
  occurredAt: Date;
  error?: string;
}

export type DeliveryStatusResult =
  { kind: 'ok'; applied: boolean; status: MessageStatus } | { kind: 'not-found' };

const DEFAULT_FAILURE_REASON = 'El proveedor reportó un fallo de envío';

/**
 * Estado de entrega de un mensaje saliente. Las transiciones son monótonas (`domain/delivery.ts`):
 * un reporte repetido o desordenado se ignora y responde `applied: false`.
 */
@Injectable()
export class UpdateDeliveryStatusUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(EVENT_INBOX) private readonly inbox: EventInbox,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Optional() @Inject(METRICS) private readonly metrics?: Metrics,
  ) {}

  /** Reporte de una integración (n8n, simulador): deduplicado por `(canal, "<messageId>:<status>")`. */
  async execute(
    integration: IntegrationContext,
    input: DeliveryStatusInput,
  ): Promise<DeliveryStatusResult> {
    const result = await this.tx.run(() => this.apply(integration, input, true));
    if (result.kind === 'ok') this.metrics?.deliveryStatusUpdate(input.status, result.applied);
    return result;
  }

  /** Cambio propio del API (el dispatcher marca `SENT` o `FAILED`): sin deduplicar. */
  applyInternal(
    integration: IntegrationContext,
    input: DeliveryStatusInput,
  ): Promise<DeliveryStatusResult> {
    return this.tx.run(() => this.apply(integration, input, false));
  }

  private async apply(
    integration: IntegrationContext,
    input: DeliveryStatusInput,
    dedupe: boolean,
  ): Promise<DeliveryStatusResult> {
    const found = await this.conversations.findMessageById(integration.tenantId, input.messageId);
    if (!found || found.channelId !== integration.channelId || found.direction !== 'OUTBOUND') {
      return { kind: 'not-found' };
    }

    // Con la fila bloqueada, dos reportes simultáneos del mismo mensaje se aplican en orden.
    const conversation = await this.conversations.findByIdForUpdate(
      integration.tenantId,
      found.conversationId,
    );
    const message = await this.conversations.findMessageById(integration.tenantId, input.messageId);
    if (!conversation || !message) return { kind: 'not-found' };

    if (dedupe) {
      const isNew = await this.inbox.recordIfNew(
        integration.channelId,
        `${input.messageId}:${input.status}`,
      );
      if (!isNew) return { kind: 'ok', applied: false, status: message.status };
    }
    if (!canTransitionDelivery(message.status, input.status)) {
      return { kind: 'ok', applied: false, status: message.status };
    }

    const now = new Date();
    const updated = await this.conversations.updateMessageDelivery(message.id, {
      status: input.status,
      ...(input.providerMessageId !== undefined && { externalId: input.providerMessageId }),
      failureReason: input.status === 'FAILED' ? (input.error ?? DEFAULT_FAILURE_REASON) : null,
      at: now,
    });
    await enqueueConversationChanged(
      this.outbox,
      integration.tenantId,
      conversation.id,
      'delivery',
      now,
    );
    return { kind: 'ok', applied: true, status: updated.status };
  }
}
