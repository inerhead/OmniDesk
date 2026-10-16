import { Inject, Injectable, Optional } from '@nestjs/common';
import { EnqueueNotificationUseCase } from '../../notifications/application/enqueue-notification.use-case';
import type { IntegrationContext } from '../../../shared/application/request-context';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import { retryOnConflict } from '../../../shared/application/retry-on-conflict';
import {
  TENANT_STATUS,
  type TenantStatusReader,
} from '../../../shared/application/tenant-status.port';
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
import { customerMessage, previewSource, type AttachmentKind } from '../domain/message';
import { enqueueConversationChanged } from './enqueue-conversation-changed';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from './ports/conversation.repository';

/** Media de WhatsApp aún sin descargar. */
export interface InboundAttachment {
  kind: AttachmentKind;
  mimeType: string;
  providerMediaId: string;
  sha256?: string;
  fileName?: string;
  voice?: boolean;
}

export interface InboundMessageInput {
  externalMessageId: string;
  from: { externalId: string; displayName?: string };
  /** Con adjunto, su pie (puede ser vacío). */
  text: string;
  sentAt: Date;
  attachment?: InboundAttachment;
}

export interface InboundMessageResult {
  conversationId: string;
  messageId: string;
  /** Adjunto que hay que descargar; null sin adjunto. */
  attachmentId: string | null;
  /** `false` también con la empresa inactiva (SPEC 16): el mensaje se guarda, pero sin IA. */
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
    @Optional() private readonly notifications?: EnqueueNotificationUseCase,
    @Optional() @Inject(TENANT_STATUS) private readonly tenantStatus?: TenantStatusReader,
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
    // Empresa inactiva (SPEC 16): el mensaje se guarda igual, sin IA ni notificaciones.
    const tenantActive = (await this.tenantStatus?.isActive(integration.tenantId)) ?? true;
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
      return toResult(
        conversation,
        existing.id,
        existing.attachment?.id ?? null,
        true,
        tenantActive,
      );
    }

    const contact = await this.contacts.findOrCreateByIdentity(
      { ...integration, externalId: input.from.externalId },
      input.from.displayName,
    );

    const now = new Date();
    const newMessage = customerMessage(
      input.text,
      input.externalMessageId,
      input.sentAt,
      input.attachment && { ...input.attachment, status: 'PENDING' },
    );
    const { conversation, created } = await this.conversationFor(
      integration,
      contact.id,
      previewSource(newMessage),
      now,
    );
    const message = await this.conversations.appendMessage(conversation, newMessage, now);
    await enqueueConversationChanged(
      this.outbox,
      integration.tenantId,
      conversation.id,
      'message',
      now,
      { inbound: true },
    );
    // Sin avisos con la empresa inactiva: nadie la atiende.
    if (tenantActive && created) {
      await this.notifications?.requested({
        tenantId: integration.tenantId,
        kind: 'new_ai_conversation',
        conversationId: conversation.id,
        actorMemberId: null,
        assignedAgentId: null,
        senderMemberId: null,
        messageId: message.id,
      });
    } else if (tenantActive && conversation.assignedAgentId) {
      await this.notifications?.requested({
        tenantId: integration.tenantId,
        kind: 'customer_message',
        conversationId: conversation.id,
        actorMemberId: null,
        assignedAgentId: conversation.assignedAgentId,
        senderMemberId: null,
        messageId: message.id,
      });
    }
    return toResult(conversation, message.id, message.attachment?.id ?? null, false, tenantActive);
  }

  /** La conversación abierta del contacto; si estaba cerrada la reabre, y si no existe crea una. */
  private async conversationFor(
    integration: IntegrationContext,
    contactId: string,
    preview: string,
    now: Date,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const open = await this.conversations.findOpen(integration.channelId, contactId);
    if (open) return { conversation: open, created: false };

    const closed = await this.conversations.findLatestClosed(integration.channelId, contactId);
    if (closed) return { conversation: await this.reopen(closed, now), created: false };

    return {
      created: true,
      conversation: await this.conversations.createOpen({
        tenantId: integration.tenantId,
        channelId: integration.channelId,
        contactId,
        at: now,
        preview: toPreview(preview),
      }),
    };
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
  attachmentId: string | null,
  duplicate: boolean,
  tenantActive: boolean,
): InboundMessageResult {
  return {
    conversationId: conversation.id,
    messageId,
    attachmentId,
    aiAllowed: tenantActive && isAiActive(conversation),
    controlVersion: conversation.controlVersion,
    duplicate,
  };
}
