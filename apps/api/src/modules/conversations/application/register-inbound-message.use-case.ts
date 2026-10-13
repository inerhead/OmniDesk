import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationContext } from '../../../shared/application/request-context';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import { retryOnConflict } from '../../../shared/application/retry-on-conflict';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  CONTACT_REPOSITORY,
  type ContactRepository,
} from '../../contacts/application/ports/contact.repository';
import { isAiActive, toPreview, type Conversation } from '../domain/conversation';
import { decideTransition } from '../domain/conversation-transitions';
import { customerMessage } from '../domain/message';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

export interface InboundMessageInput {
  externalMessageId: string;
  from: { externalId: string; displayName?: string };
  text: string;
  sentAt: Date;
}

export interface InboundMessageResult {
  conversationId: string;
  messageId: string;
  aiAllowed: boolean;
  controlVersion: number;
  duplicate: boolean;
}

@Injectable()
export class RegisterInboundMessageUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  execute(
    integration: IntegrationContext,
    input: InboundMessageInput,
    onRegistered?: (result: InboundMessageResult) => Promise<void>,
  ): Promise<InboundMessageResult> {
    return retryOnConflict(() =>
      this.tx.run(async () => {
        const result = await this.register(integration, input);
        await onRegistered?.(result);
        return result;
      }),
    );
  }

  private async register(
    integration: IntegrationContext,
    input: InboundMessageInput,
  ): Promise<InboundMessageResult> {
    const existing = await this.conversations.findMessageByExternalId(
      integration.channelId,
      input.externalMessageId,
    );
    if (existing) {
      const conversation = await this.conversations.findById(
        integration.tenantId,
        existing.conversationId,
      );
      if (!conversation) throw new Error(`Conversación ${existing.conversationId} no encontrada`);
      return toResult(conversation, existing.id, true);
    }

    const contact = await this.contacts.findOrCreateByIdentity(
      { ...integration, externalId: input.from.externalId },
      input.from.displayName,
    );

    const now = new Date();
    const conversation = await this.conversationFor(integration, contact.id, input.text, now);

    const message = await this.conversations.appendMessage(
      conversation,
      customerMessage(input.text, input.externalMessageId, input.sentAt),
      now,
    );
    await enqueueConversationChanged(
      this.outbox,
      integration.tenantId,
      conversation.id,
      'message',
      now,
    );
    return toResult(conversation, message.id, false);
  }

  /** La conversación abierta del contacto; si estaba cerrada la reabre, y si no existe crea una. */
  private async conversationFor(
    integration: IntegrationContext,
    contactId: string,
    text: string,
    now: Date,
  ): Promise<Conversation> {
    const open = await this.conversations.findOpen(integration.channelId, contactId);
    if (open) return open;

    const closed = await this.conversations.findLatestClosed(integration.channelId, contactId);
    if (closed) return this.reopen(closed, now);

    return this.conversations.createOpen({
      tenantId: integration.tenantId,
      channelId: integration.channelId,
      contactId,
      at: now,
      preview: toPreview(text),
    });
  }

  /** Reapertura automática por un mensaje del cliente: vuelve a la IA y registra `REOPENED` sin actor. */
  private async reopen(closed: Conversation, now: Date): Promise<Conversation> {
    // Con la fila bloqueada, dos mensajes simultáneos no reabren dos veces.
    const locked = await this.conversations.findByIdForUpdate(closed.tenantId, closed.id);
    if (!locked) throw new Error(`Conversación ${closed.id} no encontrada`);

    const transition = decideTransition(locked, { type: 'reopen' });
    if (!transition.ok) return locked; // otra transacción ya la reabrió

    const reopened = await this.conversations.applyTransition(locked, transition.next);
    await this.conversations.appendEvent(
      reopened,
      { type: 'REOPENED', actorMemberId: null, targetMemberId: null },
      now,
    );
    return reopened;
  }
}

function toResult(
  conversation: Conversation,
  messageId: string,
  duplicate: boolean,
): InboundMessageResult {
  return {
    conversationId: conversation.id,
    messageId,
    aiAllowed: isAiActive(conversation),
    controlVersion: conversation.controlVersion,
    duplicate,
  };
}
