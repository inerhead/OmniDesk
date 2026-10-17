import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { memberRefSelect, toMemberRefOrNull } from '../../identity/infrastructure/member-ref';
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
import { previewSource, type Message, type NewMessage } from '../domain/message';

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
  lastInboundAt: true,
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
  sender: { select: memberRefSelect },
  attachment: {
    select: {
      id: true,
      kind: true,
      mimeType: true,
      fileName: true,
      sizeBytes: true,
      voice: true,
      status: true,
      storageKey: true,
    },
  },
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

/** La foto del remitente se resuelve aquí: el dominio no conoce las columnas de `users`. */
export function toMessage({ sender, ...row }: MessageRow): Message {
  return { ...row, sender: toMemberRefOrNull(sender) };
}

function toMessageOrNull(row: MessageRow | null): Message | null {
  return row && toMessage(row);
}

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
    const summary = appendMessage(conversation, previewSource(message), at);
    // El incremento lo hace la base (UPDATE … RETURNING): dos mensajes simultáneos nunca comparten sequence.
    const { lastSequence } = await this.db.client.conversation.update({
      where: { id: conversation.id },
      data: {
        lastSequence: { increment: 1 },
        lastMessageAt: summary.lastMessageAt,
        lastMessagePreview: summary.lastMessagePreview,
        ...(message.direction === 'INBOUND' && { lastInboundAt: at }),
      },
      select: { lastSequence: true },
    });

    const { attachment, ...fields } = message;
    try {
      const row = await this.db.client.message.create({
        data: {
          tenantId: conversation.tenantId,
          channelId: conversation.channelId,
          conversationId: conversation.id,
          sequence: lastSequence,
          createdAt: at,
          ...fields,
          ...(attachment && {
            attachment: { create: { tenantId: conversation.tenantId, ...attachment } },
          }),
        },
        select: messageSelect,
      });
      return toMessage(row);
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

  async findMessageById(tenantId: string, messageId: string): Promise<Message | null> {
    return toMessageOrNull(
      await this.db.client.message.findFirst({
        where: { id: messageId, tenantId },
        select: messageSelect,
      }),
    );
  }

  async findMessageByClientId(
    conversationId: string,
    clientMessageId: string,
  ): Promise<Message | null> {
    return toMessageOrNull(
      await this.db.client.message.findUnique({
        where: { conversationId_clientMessageId: { conversationId, clientMessageId } },
        select: messageSelect,
      }),
    );
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
    const { conversation, ...messageRow } = row;
    const message = toMessage(messageRow);
    const to = conversation.contact.identities.find(
      (identity) => identity.channelId === message.channelId,
    )?.externalId;
    return to ? { message, tenantId, to } : null;
  }

  async updateMessageDelivery(messageId: string, update: MessageDeliveryUpdate): Promise<Message> {
    return toMessage(
      await this.db.client.message.update({
        where: { id: messageId },
        data: {
          status: update.status,
          failureReason: update.failureReason,
          statusUpdatedAt: update.at,
          ...(update.externalId !== undefined && { externalId: update.externalId }),
        },
        select: messageSelect,
      }),
    );
  }

  async findMessageByExternalId(channelId: string, externalId: string): Promise<Message | null> {
    return toMessageOrNull(
      await this.db.client.message.findUnique({
        where: { channelId_externalId: { channelId, externalId } },
        select: messageSelect,
      }),
    );
  }

  listFailedOutboundByReason(
    tenantId: string,
    reason: string,
  ): Promise<Array<{ id: string; conversationId: string }>> {
    return this.db.client.message.findMany({
      where: { tenantId, direction: 'OUTBOUND', status: 'FAILED', failureReason: reason },
      orderBy: [{ conversationId: 'asc' }, { sequence: 'asc' }],
      select: { id: true, conversationId: true },
    });
  }

  async relabelFailedOutbound(tenantId: string, from: string, to: string): Promise<number> {
    const { count } = await this.db.client.message.updateMany({
      where: { tenantId, direction: 'OUTBOUND', status: 'FAILED', failureReason: from },
      data: { failureReason: to },
    });
    return count;
  }

  async listAiHistory(
    tenantId: string,
    conversationId: string,
    beforeSequence: number,
    limit: number,
  ): Promise<Message[]> {
    const rows = await this.db.client.message.findMany({
      where: {
        tenantId,
        conversationId,
        sequence: { lt: beforeSequence },
        NOT: { direction: 'OUTBOUND', status: 'FAILED' },
      },
      orderBy: { sequence: 'desc' },
      take: limit,
      select: messageSelect,
    });
    return rows.reverse().map(toMessage);
  }

  async findMessageByIdempotencyKey(
    conversationId: string,
    idempotencyKey: string,
  ): Promise<Message | null> {
    return toMessageOrNull(
      await this.db.client.message.findUnique({
        where: { conversationId_idempotencyKey: { conversationId, idempotencyKey } },
        select: messageSelect,
      }),
    );
  }
}
