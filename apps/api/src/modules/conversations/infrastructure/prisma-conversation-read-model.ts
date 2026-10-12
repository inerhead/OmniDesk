import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  ConversationPosition,
  ConversationReadModel,
  ConversationSummaryView,
} from '../application/ports/conversation-read-model';
import type { Message } from '../domain/message';

@Injectable()
export class PrismaConversationReadModel implements ConversationReadModel {
  constructor(private readonly db: PrismaDb) {}

  async listSummaries(
    tenantId: string,
    after: ConversationPosition | null,
    take: number,
  ): Promise<ConversationSummaryView[]> {
    const rows = await this.db.client.conversation.findMany({
      where: {
        tenantId,
        ...(after && {
          OR: [
            { lastMessageAt: { lt: after.lastMessageAt } },
            { lastMessageAt: after.lastMessageAt, id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        status: true,
        assignedAgentId: true,
        channelId: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        channel: { select: { id: true, name: true, type: true } },
        contact: {
          select: {
            id: true,
            displayName: true,
            identities: { select: { channelId: true, externalId: true } },
          },
        },
      },
    });

    return rows.map(({ channelId, contact, ...row }) => ({
      ...row,
      contact: {
        id: contact.id,
        displayName: contact.displayName,
        // Identidad del contacto en el canal de la conversación (su teléfono en WhatsApp).
        externalId:
          contact.identities.find((identity) => identity.channelId === channelId)?.externalId ?? '',
      },
    }));
  }

  async conversationExists(tenantId: string, conversationId: string): Promise<boolean> {
    const found = await this.db.client.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true },
    });
    return found !== null;
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
      select: {
        id: true,
        conversationId: true,
        sequence: true,
        direction: true,
        senderType: true,
        text: true,
        status: true,
        createdAt: true,
      },
    });
  }
}
