import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../shared/config/env';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import { resolveRecipients, type NotificationKind } from '../domain/notification';
import { pushConfigured } from './push-configured';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from './ports/notification.repository';

export interface NotificationRequest {
  tenantId: string;
  kind: NotificationKind;
  conversationId: string;
  actorMemberId: string | null;
  assignedAgentId: string | null;
  senderMemberId: string | null;
  messageId?: string;
}

/**
 * Encola `notification.requested` en la transacción del cambio. Sin VAPID, o sin destinatarios,
 * no escribe nada.
 */
@Injectable()
export class EnqueueNotificationUseCase {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
  ) {}

  async requested(input: NotificationRequest): Promise<void> {
    if (!pushConfigured(this.env)) return;
    const members = await this.notifications.listMemberPrefs(input.tenantId);
    const recipientMemberIds = resolveRecipients(input.kind, { ...input, members });
    if (recipientMemberIds.length === 0) return;
    await this.outbox.enqueue({
      tenantId: input.tenantId,
      type: 'notification.requested',
      payload: {
        kind: input.kind,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        recipientMemberIds,
        ...(input.messageId && { messageId: input.messageId }),
      },
    });
  }
}
