import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import type { ActorContext } from '../../../shared/application/request-context';
import { retryOnConflict } from '../../../shared/application/retry-on-conflict';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { can } from '../domain/conversation-policy';
import { agentMessage, type Message } from '../domain/message';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import { enqueueSendRequested } from './enqueue-send-requested';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

export interface SendAgentMessageInput {
  conversationId: string;
  text: string;
  clientMessageId: string;
}

export type SendAgentMessageResult =
  | { kind: 'ok'; message: Message; duplicate: boolean }
  /** La conversación no existe, o el actor no puede verla. */
  | { kind: 'not-found' }
  /** La ve, pero no es el agente asignado. */
  | { kind: 'forbidden' }
  | { kind: 'rejected'; reason: 'INVALID_STATE' };

/**
 * Registra el mensaje del agente como `PENDING` y encola su envío (arquitectura §12). El envío
 * al proveedor lo hace el dispatcher del Outbox: nunca dentro de esta transacción.
 */
@Injectable()
export class SendAgentMessageUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  execute(actor: ActorContext, input: SendAgentMessageInput): Promise<SendAgentMessageResult> {
    return retryOnConflict(() => this.tx.run(() => this.send(actor, input)));
  }

  private async send(
    actor: ActorContext,
    input: SendAgentMessageInput,
  ): Promise<SendAgentMessageResult> {
    const conversation = await this.conversations.findByIdForUpdate(
      actor.tenantId,
      input.conversationId,
    );
    if (!conversation || !can(actor, 'view', conversation)) return { kind: 'not-found' };
    // Solo escribe el agente asignado: un OWNER/ADMIN primero se asigna la conversación.
    if (conversation.assignedAgentId !== actor.memberId) return { kind: 'forbidden' };

    // Idempotencia: un reintento del composer devuelve el mismo mensaje.
    const existing = await this.conversations.findMessageByClientId(
      conversation.id,
      input.clientMessageId,
    );
    if (existing) return { kind: 'ok', message: existing, duplicate: true };

    if (conversation.status !== 'OPEN') return { kind: 'rejected', reason: 'INVALID_STATE' };

    const now = new Date();
    const message = await this.conversations.appendMessage(
      conversation,
      agentMessage(input.text, actor.memberId, input.clientMessageId),
      now,
    );
    await enqueueSendRequested(this.outbox, actor.tenantId, message.id);
    await enqueueConversationChanged(this.outbox, actor.tenantId, conversation.id, 'delivery', now);
    return { kind: 'ok', message, duplicate: false };
  }
}
