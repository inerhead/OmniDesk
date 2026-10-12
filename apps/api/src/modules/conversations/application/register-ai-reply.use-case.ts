import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationContext } from '../../../shared/application/request-context';
import { retryOnConflict } from '../../../shared/application/retry-on-conflict';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { decideAiReply } from '../domain/conversation';
import { aiReply } from '../domain/message';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

export interface AiReplyInput {
  conversationId: string;
  controlVersion: number;
  idempotencyKey: string;
  text: string;
}

export type AiReplyResult =
  | { kind: 'accepted'; messageId: string }
  | { kind: 'rejected'; reason: 'CONTROL_CHANGED' | 'CONVERSATION_CLOSED' }
  | { kind: 'not-found' };

/** Registra la respuesta de IA como PENDING antes de que la integración la envíe (arquitectura §9). */
@Injectable()
export class RegisterAiReplyUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
  ) {}

  execute(integration: IntegrationContext, input: AiReplyInput): Promise<AiReplyResult> {
    return retryOnConflict(() => this.tx.run(() => this.register(integration, input)));
  }

  private async register(
    integration: IntegrationContext,
    input: AiReplyInput,
  ): Promise<AiReplyResult> {
    const conversation = await this.conversations.findByIdForUpdate(
      integration.tenantId,
      input.conversationId,
    );
    if (!conversation || conversation.channelId !== integration.channelId)
      return { kind: 'not-found' };

    // Idempotencia: un reintento de la integración devuelve el mismo mensaje.
    const existing = await this.conversations.findMessageByIdempotencyKey(
      conversation.id,
      input.idempotencyKey,
    );
    if (existing) return { kind: 'accepted', messageId: existing.id };

    const decision = decideAiReply(conversation, input.controlVersion);
    if (!decision.allowed) return { kind: 'rejected', reason: decision.reason };

    const message = await this.conversations.appendMessage(
      conversation,
      aiReply(input.text, input.idempotencyKey),
      new Date(),
    );
    return { kind: 'accepted', messageId: message.id };
  }
}
