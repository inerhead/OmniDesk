import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { canSendNow } from '../domain/conversation';
import { can } from '../domain/conversation-policy';
import type { Message } from '../domain/message';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import { enqueueSendRequested } from './enqueue-send-requested';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

export interface RetryFailedMessageInput {
  conversationId: string;
  messageId: string;
}

export type RetryFailedMessageResult =
  | { kind: 'ok'; message: Message }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'rejected'; reason: 'INVALID_STATE' | 'WINDOW_CLOSED' };

/** Reintento manual: devuelve un mensaje `FAILED` a `PENDING` y encola un nuevo envío. */
@Injectable()
export class RetryFailedMessageUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  execute(actor: ActorContext, input: RetryFailedMessageInput): Promise<RetryFailedMessageResult> {
    return this.tx.run(() => this.retry(actor, input));
  }

  private async retry(
    actor: ActorContext,
    input: RetryFailedMessageInput,
  ): Promise<RetryFailedMessageResult> {
    const conversation = await this.conversations.findByIdForUpdate(
      actor.tenantId,
      input.conversationId,
    );
    if (!conversation || !can(actor, 'view', conversation)) return { kind: 'not-found' };

    const message = await this.conversations.findMessageById(actor.tenantId, input.messageId);
    if (!message || message.conversationId !== conversation.id) return { kind: 'not-found' };
    if (conversation.assignedAgentId !== actor.memberId) return { kind: 'forbidden' };
    if (message.status !== 'FAILED') return { kind: 'rejected', reason: 'INVALID_STATE' };

    const now = new Date();
    if (!canSendNow(conversation, now)) return { kind: 'rejected', reason: 'WINDOW_CLOSED' };
    const pending = await this.conversations.updateMessageDelivery(message.id, {
      status: 'PENDING',
      failureReason: null,
      at: now,
    });
    await enqueueSendRequested(this.outbox, actor.tenantId, message.id);
    await enqueueConversationChanged(this.outbox, actor.tenantId, conversation.id, 'delivery', now);
    return { kind: 'ok', message: pending };
  }
}
