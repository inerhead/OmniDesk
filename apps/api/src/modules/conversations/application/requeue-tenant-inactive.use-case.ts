import { Inject, Injectable } from '@nestjs/common';
import { TENANT_INACTIVE_REASON } from '@omnidesk/contracts';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import { canSendNow } from '../domain/conversation';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import { enqueueSendRequested } from './enqueue-send-requested';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

/**
 * Al reactivar una empresa (SPEC 16): los salientes que fallaron por `TENANT_INACTIVE` vuelven a
 * `PENDING` y se encolan, solo si la conversación sigue abierta y dentro de la ventana de 18 h. Los
 * demás se quedan `FAILED`. Debe llamarse dentro de la transacción de la reactivación.
 */
@Injectable()
export class RequeueTenantInactiveUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  async requeueTenantInactive(tenantId: string, now: Date): Promise<number> {
    const failed = await this.conversations.listFailedOutboundByReason(
      tenantId,
      TENANT_INACTIVE_REASON,
    );
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
