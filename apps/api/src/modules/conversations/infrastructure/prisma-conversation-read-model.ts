import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  ConversationEventView,
  ConversationFilter,
  ConversationPosition,
  ConversationReadModel,
  ConversationSummaryView,
} from '../application/ports/conversation-read-model';
import type { Conversation } from '../domain/conversation';
import type { Message } from '../domain/message';
import { messageSelect } from './prisma-conversation.repository';

const summarySelect = {
  id: true,
  status: true,
  controlVersion: true,
  channelId: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  assignedAgent: { select: { id: true, displayName: true } },
  channel: { select: { id: true, name: true, type: true } },
  contact: {
    select: {
      id: true,
      displayName: true,
      identities: { select: { channelId: true, externalId: true } },
    },
  },
} satisfies Prisma.ConversationSelect;

type SummaryRow = Prisma.ConversationGetPayload<{ select: typeof summarySelect }>;

function toSummaryView({ channelId, contact, ...row }: SummaryRow): ConversationSummaryView {
  return {
    ...row,
    contact: {
      id: contact.id,
      displayName: contact.displayName,
      // Identidad del contacto en el canal de la conversación (su teléfono en WhatsApp).
      externalId:
        contact.identities.find((identity) => identity.channelId === channelId)?.externalId ?? '',
    },
  };
}

@Injectable()
export class PrismaConversationReadModel implements ConversationReadModel {
  constructor(private readonly db: PrismaDb) {}

  async listSummaries(
    tenantId: string,
    filter: ConversationFilter,
    after: ConversationPosition | null,
    take: number,
  ): Promise<ConversationSummaryView[]> {
    const rows = await this.db.client.conversation.findMany({
      where: {
        tenantId,
        status: filter.status,
        ...(filter.assignedAgentId !== undefined && { assignedAgentId: filter.assignedAgentId }),
        ...(after && {
          OR: [
            { lastMessageAt: { lt: after.lastMessageAt } },
            { lastMessageAt: after.lastMessageAt, id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take,
      select: summarySelect,
    });
    return rows.map(toSummaryView);
  }

  async getSummary(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationSummaryView | null> {
    const row = await this.db.client.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: summarySelect,
    });
    return row ? toSummaryView(row) : null;
  }

  findAccess(
    tenantId: string,
    conversationId: string,
  ): Promise<Pick<Conversation, 'status' | 'assignedAgentId'> | null> {
    return this.db.client.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { status: true, assignedAgentId: true },
    });
  }

  listMessagesDescending(
    conversationId: string,
    before: number | null,
    take: number,
  ): Promise<Message[]> {
    return this.db.client.message.findMany({
      where: { conversationId, ...(before !== null && { sequence: { lt: before } }) },
      orderBy: { sequence: 'desc' },
      take,
      select: messageSelect,
    });
  }

  listEventsDescending(
    conversationId: string,
    before: number | null,
    take: number,
  ): Promise<ConversationEventView[]> {
    return this.db.client.conversationEvent.findMany({
      where: { conversationId, ...(before !== null && { sequence: { lt: before } }) },
      orderBy: { sequence: 'desc' },
      take,
      select: {
        id: true,
        sequence: true,
        type: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true } },
        target: { select: { id: true, displayName: true } },
      },
    });
  }
}
