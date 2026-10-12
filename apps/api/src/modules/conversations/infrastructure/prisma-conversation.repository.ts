import { Injectable } from '@nestjs/common';
import { rethrowUniqueConflict } from '../../../shared/infrastructure/prisma/prisma-errors';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  ConversationRepository,
  NewConversation,
} from '../application/ports/conversation.repository';
import { appendMessage, type Conversation } from '../domain/conversation';
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

const messageSelect = {
  id: true,
  conversationId: true,
  sequence: true,
  direction: true,
  senderType: true,
  text: true,
  status: true,
  createdAt: true,
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
