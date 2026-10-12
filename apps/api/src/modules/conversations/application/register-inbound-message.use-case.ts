import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationContext } from '../../../shared/application/request-context';
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
import { customerMessage } from '../domain/message';
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
  ) {}

  execute(
    integration: IntegrationContext,
    input: InboundMessageInput,
  ): Promise<InboundMessageResult> {
    return retryOnConflict(() => this.tx.run(() => this.register(integration, input)));
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
    const conversation =
      (await this.conversations.findOpen(integration.channelId, contact.id)) ??
      (await this.conversations.createOpen({
        tenantId: integration.tenantId,
        channelId: integration.channelId,
        contactId: contact.id,
        at: now,
        preview: toPreview(input.text),
      }));

    const message = await this.conversations.appendMessage(
      conversation,
      customerMessage(input.text, input.externalMessageId, input.sentAt),
      now,
    );
    return toResult(conversation, message.id, false);
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
