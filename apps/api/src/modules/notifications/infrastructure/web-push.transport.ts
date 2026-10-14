import { Inject, Injectable } from '@nestjs/common';
import webpush from 'web-push';
import { ENV, type Env } from '../../../shared/config/env';
import { pushConfigured } from '../application/push-configured';
import type { StoredSubscription } from '../application/ports/notification.repository';
import { PushEndpointGoneError, type PushTransport } from '../application/ports/push-transport';

@Injectable()
export class WebPushTransport implements PushTransport {
  constructor(@Inject(ENV) private readonly env: Env) {
    if (pushConfigured(env) && env.VAPID_SUBJECT && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    }
  }

  async send(
    subscription: StoredSubscription,
    body: string,
    options: { ttl: number; topic: string },
  ): Promise<void> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
        { TTL: options.ttl, topic: options.topic },
      );
    } catch (error) {
      const status = statusCode(error);
      if (status === 404 || status === 410) throw new PushEndpointGoneError(status);
      throw error;
    }
  }
}

function statusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
