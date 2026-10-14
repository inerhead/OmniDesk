import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../shared/config/env';
import { DeliverPushUseCase } from './deliver-push.use-case';
import type { NotificationRepository } from './ports/notification.repository';
import { PushEndpointGoneError, type PushTransport } from './ports/push-transport';
import { PresenceRegistry } from './presence-registry';

const conversationId = '018f0b3e-7b3a-7c2a-8e1a-111111111111';
const tenantId = '018f0b3e-7b3a-7c2a-8e1a-222222222222';
const memberId = '018f0b3e-7b3a-7c2a-8e1a-333333333333';

const env = {
  VAPID_PUBLIC_KEY: 'public',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_SUBJECT: 'mailto:soporte@gastromesa.com',
  PUBLIC_BASE_PATH: '/omnidesk',
} as Env;

function repository(overrides: Partial<NotificationRepository> = {}): NotificationRepository {
  return {
    listMemberPrefs: vi.fn(),
    upsertSubscription: vi.fn(),
    deleteOwnSubscription: vi.fn(),
    deleteByEndpoint: vi.fn(),
    touch: vi.fn(),
    subscriptionsOf: vi.fn(async () => []),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    loadDelivery: vi.fn(async () => ({
      contact: { displayName: 'Ana', externalId: '+57300' },
      preview: 'hola',
      targets: [
        {
          memberId,
          subscriptions: [
            { endpoint: 'https://push.example/gone', p256dh: 'a', auth: 'b' },
            { endpoint: 'https://push.example/ok', p256dh: 'c', auth: 'd' },
          ],
        },
      ],
    })),
    ...overrides,
  };
}

describe('DeliverPushUseCase', () => {
  it('borra el endpoint 410 y sigue con el resto de dispositivos', async () => {
    const notifications = repository();
    const transport: PushTransport = {
      send: vi.fn(async (subscription) => {
        if (subscription.endpoint.endsWith('/gone')) throw new PushEndpointGoneError(410);
      }),
    };
    const useCase = new DeliverPushUseCase(env, notifications, transport, new PresenceRegistry());

    await useCase.deliver({
      kind: 'customer_message',
      tenantId,
      conversationId,
      recipientMemberIds: [memberId],
    });

    expect(notifications.deleteByEndpoint).toHaveBeenCalledWith('https://push.example/gone');
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(notifications.touch).toHaveBeenCalledWith('https://push.example/ok', expect.any(Date));
  });

  it('un fallo transitorio se propaga para que el Outbox reintente', async () => {
    const transport: PushTransport = {
      send: vi.fn(async () => {
        throw new Error('timeout');
      }),
    };
    const useCase = new DeliverPushUseCase(env, repository(), transport, new PresenceRegistry());

    await expect(
      useCase.deliver({
        kind: 'assigned',
        tenantId,
        conversationId,
        recipientMemberIds: [memberId],
      }),
    ).rejects.toThrow('timeout');
  });

  it('la prueba responde no-devices si el usuario no tiene suscripciones', async () => {
    const useCase = new DeliverPushUseCase(env, repository(), { send: vi.fn() }, new PresenceRegistry());
    await expect(useCase.sendTest('user', tenantId)).resolves.toBe('no-devices');
  });
});
