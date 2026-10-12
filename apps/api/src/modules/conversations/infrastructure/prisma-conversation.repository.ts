import { Injectable } from '@nestjs/common';
import { rethrowUniqueConflict } from '../../../shared/infrastructure/prisma/prisma-errors';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  ConversationRepository,
  MessageDeliveryUpdate,
  NewConversation,
  OutboundForSend,
} from '../application/ports/conversation.repository';
import { appendMessage, type Conversation } from '../domain/conversation';
import type { ConversationEvent, NewConversationEvent } from '../domain/conversation-event';
import type { ConversationState } from '../domain/conversation-transitions';
import type { Message, NewMessage } from '../domain/message';

const conversationSelect = {
  id: true,
  tenantId: true,
  channelId: true,
  contactId: true,
  status: true,
  assignedAgentId: true,
  controlVersion: true,
  lastSequence: true,
  lastMessageAt: true,
  lastMessagePreview: true,
} as const;

export const messageSelect = {
  id: true,
  conversationId: true,
  channelId: true,
  sequence: true,
  direction: true,
  senderType: true,
  text: true,
  status: true,
  externalId: true,
  failureReason: true,
  createdAt: true,
  sender: { select: { id: true, displayName: true } },
} as const;

@Injectable()
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: PrismaDb) {}

  findById(tenantId: string, id: string): Promise<Conversation | null> {
    return this.db.client.conversation.findFirst({
      where: { id, tenantId },
      select: conversationSelect,
    });
  }

  async findByIdForUpdate(tenantId: string, id: string): Promise<Conversation | null> {
    await this.db.client
      .$queryRaw`SELECT id FROM conversations WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
    return this.findById(tenantId, id);
  }

  findOpen(channelId: string, contactId: string): Promise<Conversation | null> {
    return this.db.client.conversation.findFirst({
      where: { channelId, contactId, status: 'OPEN' },
      select: conversationSelect,
    });
  }

  findLatestClosed(channelId: string, contactId: string): Promise<Conversation | null> {
    return this.db.client.conversation.findFirst({
      where: { channelId, contactId, status: 'CLOSED' },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      select: conversationSelect,
    });
  }

  async createOpen(data: NewConversation): Promise<Conversation> {
    try {
      return await this.db.client.conversation.create({
        data: {
          tenantId: data.tenantId,
          channelId: data.channelId,
          contactId: data.contactId,
          lastMessageAt: data.at,
          lastMessagePreview: data.preview,
        },
        select: conversationSelect,
      });
    } catch (error) {
      rethrowUniqueConflict(error);
    }
  }

  async appendMessage(conversation: Conversation, message: NewMessage, at: Date): Promise<Message> {
    const summary = appendMessage(conversation, message.text, at);
    // El incremento lo hace la base (UPDATE … RETURNING): dos mensajes simultáneos nunca comparten sequence.
    const { lastSequence } = await this.db.client.conversation.update({
      where: { id: conversation.id },
      data: {
        lastSequence: { increment: 1 },
        lastMessageAt: summary.lastMessageAt,
        lastMessagePreview: summary.lastMessagePreview,
      },
      select: { lastSequence: true },
    });

    try {
      return await this.db.client.message.create({
        data: {
          tenantId: conversation.tenantId,
          channelId: conversation.channelId,
          conversationId: conversation.id,
          sequence: lastSequence,
          createdAt: at,
          ...message,
        },
        select: messageSelect,
      });
    } catch (error) {
      rethrowUniqueConflict(error);
    }
  }

  applyTransition(conversation: Conversation, next: ConversationState): Promise<Conversation> {
    return this.db.client.conversation.update({
      where: { id: conversation.id },
      data: {
        status: next.status,
        assignedAgentId: next.assignedAgentId,
        controlVersion: { increment: 1 },
      },
      select: conversationSelect,
    });
  }

  async appendEvent(
    conversation: Conversation,
    event: NewConversationEvent,
    at: Date,
  ): Promise<ConversationEvent> {
    // Igual que en los mensajes, el incremento lo hace la base: nunca hay dos con la misma sequence.
    const { lastSequence } = await this.db.client.conversation.update({
      where: { id: conversation.id },
      data: { lastSequence: { increment: 1 } },
      select: { lastSequence: true },
    });
    return this.db.client.conversationEvent.create({
      data: {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        sequence: lastSequence,
        createdAt: at,
        ...event,
      },
      select: {
        id: true,
        conversationId: true,
        sequence: true,
        type: true,
        actorMemberId: true,
        targetMemberId: true,
        createdAt: true,
      },
    });
  }

  findMessageById(tenantId: string, messageId: string): Promise<Message | null> {
    return this.db.client.message.findFirst({
      where: { id: messageId, tenantId },
      select: messageSelect,
    });
  }

  findMessageByClientId(conversationId: string, clientMessageId: string): Promise<Message | null> {
    return this.db.client.message.findUnique({
      where: { conversationId_clientMessageId: { conversationId, clientMessageId } },
      select: messageSelect,
    });
  }

  async findOutboundForSend(tenantId: string, messageId: string): Promise<OutboundForSend | null> {
    const row = await this.db.client.message.findFirst({
      where: { id: messageId, tenantId, direction: 'OUTBOUND' },
      select: {
        ...messageSelect,
        conversation: {
          select: {
            contact: {
              select: { identities: { select: { channelId: true, externalId: true } } },
            },
          },
        },
      },
    });
    if (!row) return null;
    const { conversation, ...message } = row;
    const to = conversation.contact.identities.find(
      (identity) => identity.channelId === message.channelId,
    )?.externalId;
    return to ? { message, tenantId, to } : null;
  }

  updateMessageDelivery(messageId: string, update: MessageDeliveryUpdate): Promise<Message> {
    return this.db.client.message.update({
      where: { id: messageId },
      data: {
        status: update.status,
        failureReason: update.failureReason,
        statusUpdatedAt: update.at,
        ...(update.externalId !== undefined && { externalId: update.externalId }),
      },
      select: messageSelect,
    });
  }

  findMessageByExternalId(channelId: string, externalId: string): Promise<Message | null> {
    return this.db.client.message.findUnique({
      where: { channelId_externalId: { channelId, externalId } },
      select: messageSelect,
    });
  }

  findMessageByIdempotencyKey(
    conversationId: string,
    idempotencyKey: string,
  ): Promise<Message | null> {
    return this.db.client.message.findUnique({
      where: { conversationId_idempotencyKey: { conversationId, idempotencyKey } },
      select: messageSelect,
    });
  }
}
