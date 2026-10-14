import type { StoredSubscription } from './notification.repository';

export class PushEndpointGoneError extends Error {
  constructor(readonly status: 404 | 410) {
    super(`Suscripción caducada (${status})`);
    this.name = 'PushEndpointGoneError';
  }
}

export interface PushTransport {
  send(
    subscription: StoredSubscription,
    body: string,
    options: { ttl: number; topic: string },
  ): Promise<void>;
}

export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');
