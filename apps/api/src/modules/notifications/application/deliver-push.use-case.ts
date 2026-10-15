import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../../shared/config/env';
import { buildPushPayload, shouldSuppress } from '../domain/notification';
import { PresenceRegistry } from './presence-registry';
import { pushConfigured } from './push-configured';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from './ports/notification.repository';
import { PUSH_TRANSPORT, PushEndpointGoneError, type PushTransport } from './ports/push-transport';

export const PUSH_TTL_SECONDS = 60 * 60;

const NotificationRequestedSchema = z.object({
  kind: z.enum(['assigned', 'customer_message', 'send_failed', 'new_ai_conversation']),
  tenantId: z.uuid(),
  conversationId: z.uuid(),
  recipientMemberIds: z.array(z.uuid()),
  messageId: z.uuid().optional(),
});

const PlatformPushRequestedSchema = z.object({
  userIds: z.array(z.uuid()),
  title: z.string(),
  body: z.string(),
  url: z.string().startsWith('/'),
  tag: z.string(),
});

export interface PushSender {
  deliver(payload: unknown): Promise<void>;
  /** `platform.push_requested` (SPEC 18): a usuarios, sin preferencias ni presencia. */
  deliverPlatform(payload: unknown): Promise<void>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Entrega un `notification.requested` a los dispositivos de los destinatarios. */
@Injectable()
export class DeliverPushUseCase implements PushSender {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
    @Inject(PUSH_TRANSPORT) private readonly transport: PushTransport,
    private readonly presence: PresenceRegistry,
  ) {}

  async deliver(payload: unknown): Promise<void> {
    if (!pushConfigured(this.env)) return;
    const event = NotificationRequestedSchema.parse(payload);
    const context = await this.notifications.loadDelivery(event);
    if (!context) return;

    const body = JSON.stringify(
      buildPushPayload(
        event.kind,
        context.contact,
        context.preview,
        event.conversationId,
        event.tenantId,
        this.env.PUBLIC_BASE_PATH,
      ),
    );
    const topic = event.conversationId.replaceAll('-', '');

    for (const target of context.targets) {
      if (
        shouldSuppress(event.kind, target.memberId, event.conversationId, this.presence.snapshot())
      ) {
        continue;
      }
      for (const subscription of target.subscriptions) {
        try {
          await this.transport.send(subscription, body, { ttl: PUSH_TTL_SECONDS, topic });
          await this.notifications.touch(subscription.endpoint, new Date());
        } catch (error) {
          if (error instanceof PushEndpointGoneError) {
            await this.notifications.deleteByEndpoint(subscription.endpoint);
            continue;
          }
          throw error;
        }
      }
    }
  }

  async deliverPlatform(payload: unknown): Promise<void> {
    if (!pushConfigured(this.env)) return;
    const event = PlatformPushRequestedSchema.parse(payload);
    const prefix = this.env.PUBLIC_BASE_PATH === '/' ? '' : this.env.PUBLIC_BASE_PATH;
    // Sin empresa: abrir el aviso no cambia la empresa activa.
    const body = JSON.stringify({
      title: event.title,
      body: event.body,
      tag: event.tag,
      url: `${prefix}${event.url}`,
      tenantId: '',
    });
    const topic = event.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(-32);
    for (const userId of new Set(event.userIds)) {
      for (const subscription of await this.notifications.subscriptionsOf(userId)) {
        try {
          await this.transport.send(subscription, body, { ttl: PUSH_TTL_SECONDS, topic });
          await this.notifications.touch(subscription.endpoint, new Date());
        } catch (error) {
          if (error instanceof PushEndpointGoneError) {
            await this.notifications.deleteByEndpoint(subscription.endpoint);
            continue;
          }
          throw error;
        }
      }
    }
  }

  /** Aviso inmediato a los dispositivos del usuario, sin pasar por el Outbox. */
  async sendTest(userId: string, tenantId: string): Promise<'sent' | 'disabled' | 'no-devices'> {
    if (!pushConfigured(this.env)) return 'disabled';
    const subscriptions = await this.notifications.subscriptionsOf(userId);
    if (subscriptions.length === 0) return 'no-devices';
    const prefix = this.env.PUBLIC_BASE_PATH === '/' ? '' : this.env.PUBLIC_BASE_PATH;
    const body = JSON.stringify({
      title: 'OmniDesk',
      body: 'Notificación de prueba',
      tag: `push-test-${userId}`,
      url: `${prefix}/conversations`,
      tenantId,
    });
    for (const subscription of subscriptions) {
      try {
        await this.transport.send(subscription, body, {
          ttl: PUSH_TTL_SECONDS,
          topic: 'omnideskpushtest'.slice(0, 32),
        });
        await this.notifications.touch(subscription.endpoint, new Date());
      } catch (error) {
        if (error instanceof PushEndpointGoneError) {
          await this.notifications.deleteByEndpoint(subscription.endpoint);
          continue;
        }
        throw error;
      }
    }
    return 'sent';
  }
}
