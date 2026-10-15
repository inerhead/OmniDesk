import { Inject, Injectable } from '@nestjs/common';
import { TENANT_INACTIVE_REASON, TENANT_SUSPENDED_REASON } from '@omnidesk/contracts';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import { canSendNow } from '../domain/conversation';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import { enqueueSendRequested } from './enqueue-send-requested';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

/**
 * Al reactivar una empresa (SPEC 16) o levantar su suspensión (SPEC 18): los salientes que fallaron
 * por ese corte vuelven a `PENDING` y se encolan, solo si la conversación sigue abierta y dentro de la
 * ventana de 18 h. Los demás se quedan `FAILED`. Debe llamarse dentro de la transacción del cambio.
 */
@Injectable()
export class RequeueTenantInactiveUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  requeueTenantInactive(tenantId: string, now: Date): Promise<number> {
    return this.requeue(tenantId, TENANT_INACTIVE_REASON, now);
  }

  requeueTenantSuspended(tenantId: string, now: Date): Promise<number> {
    return this.requeue(tenantId, TENANT_SUSPENDED_REASON, now);
  }

  /**
   * Se levanta la suspensión de una empresa que su Owner inactivó: los cortados por la suspensión
   * pasan a `TENANT_INACTIVE`, para que los reencole la reactivación (SPEC 18).
   */
  handOverSuspendedToInactive(tenantId: string): Promise<number> {
    return this.conversations.relabelFailedOutbound(
      tenantId,
      TENANT_SUSPENDED_REASON,
      TENANT_INACTIVE_REASON,
    );
  }

  private async requeue(tenantId: string, reason: string, now: Date): Promise<number> {
    const failed = await this.conversations.listFailedOutboundByReason(tenantId, reason);
    let requeued = 0;
    const changed = new Set<string>();
    for (const message of failed) {
      const conversation = await this.conversations.findByIdForUpdate(
        tenantId,
        message.conversationId,
      );
      if (!conversation || conversation.status !== 'OPEN' || !canSendNow(conversation, now)) {
        continue;
      }
      await this.conversations.updateMessageDelivery(message.id, {
        status: 'PENDING',
        failureReason: null,
        at: now,
      });
      await enqueueSendRequested(this.outbox, tenantId, message.id);
      changed.add(conversation.id);
      requeued += 1;
    }
    for (const conversationId of changed) {
      await enqueueConversationChanged(this.outbox, tenantId, conversationId, 'delivery', now);
    }
    return requeued;
  }
}
