import type { NotificationPreferences } from '@omnidesk/contracts';
import type { MemberPrefs, NotificationKind, PushContact } from '../../domain/notification';

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface DeliveryTarget {
  memberId: string;
  subscriptions: StoredSubscription[];
}

export interface DeliveryContext {
  contact: PushContact;
  preview: string | null;
  targets: DeliveryTarget[];
}

export interface NotificationRequested {
  kind: NotificationKind;
  tenantId: string;
  conversationId: string;
  recipientMemberIds: string[];
  messageId?: string;
}

export interface NotificationRepository {
  listMemberPrefs(tenantId: string): Promise<MemberPrefs[]>;
  upsertSubscription(userId: string, input: SubscriptionInput): Promise<'created' | 'updated'>;
  /** Borra la suscripción si es de este usuario. No toca la de otra persona. */
  deleteOwnSubscription(userId: string, endpoint: string): Promise<void>;
  deleteByEndpoint(endpoint: string): Promise<void>;
  touch(endpoint: string, at: Date): Promise<void>;
  subscriptionsOf(userId: string): Promise<StoredSubscription[]>;
  getPreferences(tenantId: string, memberId: string): Promise<NotificationPreferences | null>;
  updatePreferences(
    tenantId: string,
    memberId: string,
    prefs: NotificationPreferences,
  ): Promise<NotificationPreferences | null>;
  loadDelivery(event: NotificationRequested): Promise<DeliveryContext | null>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
