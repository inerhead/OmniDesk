import { Injectable } from '@nestjs/common';
import type { NotificationPreferences } from '@omnidesk/contracts';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { MemberPrefs } from '../domain/notification';
import type {
  DeliveryContext,
  NotificationRepository,
  NotificationRequested,
  StoredSubscription,
  SubscriptionInput,
} from '../application/ports/notification.repository';

const preferenceSelect = {
  notifyAssigned: true,
  notifyCustomerMessage: true,
  notifySendFailed: true,
  notifyNewAiConversation: true,
} as const;

function toPreferences(row: {
  notifyAssigned: boolean;
  notifyCustomerMessage: boolean;
  notifySendFailed: boolean;
  notifyNewAiConversation: boolean;
}): NotificationPreferences {
  return {
    assigned: row.notifyAssigned,
    customerMessage: row.notifyCustomerMessage,
    sendFailed: row.notifySendFailed,
    newAiConversation: row.notifyNewAiConversation,
  };
}

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly db: PrismaDb) {}

  async listMemberPrefs(tenantId: string): Promise<MemberPrefs[]> {
    const rows = await this.db.client.tenantMember.findMany({
      where: { tenantId, removedAt: null },
      select: { id: true, role: true, ...preferenceSelect },
    });
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      notifyAssigned: row.notifyAssigned,
      notifyCustomerMessage: row.notifyCustomerMessage,
      notifySendFailed: row.notifySendFailed,
      notifyNewAiConversation: row.notifyNewAiConversation,
    }));
  }

  async upsertSubscription(
    userId: string,
    input: SubscriptionInput,
  ): Promise<'created' | 'updated'> {
    const existing = await this.db.client.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { id: true },
    });
    if (existing) {
      await this.db.client.pushSubscription.update({
        where: { id: existing.id },
        data: {
          userId,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent,
        },
      });
      return 'updated';
    }
    await this.db.client.pushSubscription.create({
      data: { userId, ...input },
    });
    return 'created';
  }

  async deleteOwnSubscription(userId: string, endpoint: string): Promise<void> {
    await this.db.client.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await this.db.client.pushSubscription.deleteMany({ where: { endpoint } });
  }

  async touch(endpoint: string, at: Date): Promise<void> {
    await this.db.client.pushSubscription.updateMany({
      where: { endpoint },
      data: { lastUsedAt: at },
    });
  }

  async subscriptionsOf(userId: string): Promise<StoredSubscription[]> {
    return this.db.client.pushSubscription.findMany({
      where: { userId },
      select: { endpoint: true, p256dh: true, auth: true },
    });
  }

  async getPreferences(tenantId: string, memberId: string): Promise<NotificationPreferences | null> {
    const row = await this.db.client.tenantMember.findFirst({
      where: { id: memberId, tenantId, removedAt: null },
      select: preferenceSelect,
    });
    return row ? toPreferences(row) : null;
  }

  async updatePreferences(
    tenantId: string,
    memberId: string,
    prefs: NotificationPreferences,
  ): Promise<NotificationPreferences | null> {
    const existing = await this.getPreferences(tenantId, memberId);
    if (!existing) return null;
    const row = await this.db.client.tenantMember.update({
      where: { id: memberId },
      data: {
        notifyAssigned: prefs.assigned,
        notifyCustomerMessage: prefs.customerMessage,
        notifySendFailed: prefs.sendFailed,
        notifyNewAiConversation: prefs.newAiConversation,
      },
      select: preferenceSelect,
    });
    return toPreferences(row);
  }

  async loadDelivery(event: NotificationRequested): Promise<DeliveryContext | null> {
    const conversation = await this.db.client.conversation.findFirst({
      where: { id: event.conversationId, tenantId: event.tenantId },
      select: {
        channelId: true,
        contact: {
          select: {
            displayName: true,
            identities: { select: { channelId: true, externalId: true } },
          },
        },
      },
    });
    if (!conversation) return null;

    const preview = event.messageId
      ? ((
          await this.db.client.message.findFirst({
            where: { id: event.messageId, conversationId: event.conversationId },
            select: { text: true },
          })
        )?.text ?? null)
      : null;

    const members = await this.db.client.tenantMember.findMany({
      where: { tenantId: event.tenantId, id: { in: event.recipientMemberIds }, removedAt: null },
      select: { id: true, userId: true },
    });
    const userIds = members.flatMap((member) => (member.userId ? [member.userId] : []));
    const subscriptions = await this.db.client.pushSubscription.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, endpoint: true, p256dh: true, auth: true },
    });

    return {
      contact: {
        displayName: conversation.contact.displayName,
        externalId:
          conversation.contact.identities.find(
            (identity) => identity.channelId === conversation.channelId,
          )?.externalId ?? '',
      },
      preview,
      targets: members.map((member) => ({
        memberId: member.id,
        subscriptions: subscriptions
          .filter((subscription) => subscription.userId === member.userId)
          .map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })),
      })),
    };
  }
}
