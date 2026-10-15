import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateDeliveryStatusUseCase } from '../../conversations/application/update-delivery-status.use-case';
import { parseEnv } from '../../../shared/config/env';
import { SimulatedMessagingProvider } from './simulated-messaging-provider';

const request = {
  tenantId: 't1',
  channel: {
    id: 'c1',
    provider: 'SIMULATED' as const,
    externalId: 'demo-whatsapp',
    webhookUrl: null,
    hmacSecretEnc: null,
  },
  conversationId: '0199c0de-0000-7000-8000-0000000000aa',
  messageId: '0199c0de-0000-7000-8000-000000000001',
  to: '+573001110001',
  text: 'Hola',
  attachment: null,
};

const build = (rate: string, random = 0.5) => {
  const reported: { status: string; providerMessageId?: string }[] = [];
  const deliveryStatus = {
    execute: vi.fn(async (_integration: unknown, input: (typeof reported)[number]) => {
      reported.push(input);
      return { kind: 'ok', applied: true, status: input.status };
    }),
  } as unknown as UpdateDeliveryStatusUseCase;
  const env = parseEnv({
    DATABASE_URL: 'postgresql://omnidesk:omnidesk@postgres:5432/omnidesk',
    DATABASE_APP_URL: 'postgresql://omnidesk_app_login:app@postgres:5432/omnidesk',
    SIMULATED_PROVIDER_FAILURE_RATE: rate,
  });
  const provider = new SimulatedMessagingProvider(
    { run: (work) => work(), runDetached: (work) => work() },
    deliveryStatus,
    env,
  );
  provider.random = () => random;
  return { provider, reported };
};

describe('SimulatedMessagingProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('devuelve un providerMessageId determinista por mensaje', async () => {
    const { provider } = build('0');

    const first = await provider.send(request);
    const second = await provider.send(request);

    expect(first).toEqual({ providerMessageId: `sim-${request.messageId}` });
    expect(second).toEqual(first);
    provider.onModuleDestroy();
  });

  it('reporta DELIVERED a los 1,5 s y READ a los 4 s', async () => {
    const { provider, reported } = build('0');
    await provider.send(request);

    await vi.advanceTimersByTimeAsync(1_499);
    expect(reported).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(reported.map((r) => r.status)).toEqual(['DELIVERED']);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reported.map((r) => r.status)).toEqual(['DELIVERED', 'READ']);
    expect(reported[0]!.providerMessageId).toBe(`sim-${request.messageId}`);
  });

  it('con tasa de fallo 1 siempre lanza y no programa estados', async () => {
    const { provider, reported } = build('1', 0.99);

    await expect(provider.send(request)).rejects.toThrow(/simulado/);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reported).toEqual([]);
  });

  it('con tasa 0 nunca falla, aunque el azar devuelva 0', async () => {
    const { provider } = build('0', 0);

    await expect(provider.send(request)).resolves.toBeDefined();
    provider.onModuleDestroy();
  });

  it('falla cuando el azar cae por debajo de la tasa', async () => {
    const { provider } = build('0.3', 0.29);

    await expect(provider.send(request)).rejects.toThrow();
  });

  it('al destruir el módulo cancela los estados programados', async () => {
    const { provider, reported } = build('0');
    await provider.send(request);

    provider.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reported).toEqual([]);
  });
});
