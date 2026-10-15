import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoopMetrics } from '../../observability/testing/noop-metrics';
import { FindOutboundForSendUseCase } from '../../conversations/application/find-outbound-for-send.use-case';
import { UpdateDeliveryStatusUseCase } from '../../conversations/application/update-delivery-status.use-case';
import {
  InMemoryConversations,
  InMemoryEventInbox,
  InMemoryOutbox,
  noTransaction,
} from '../../conversations/testing/in-memory';
import { agentMessage } from '../../conversations/domain/message';
import { DispatchOutboundMessageUseCase } from './dispatch-outbound-message.use-case';
import type { ChannelForSend } from '../../channels/application/ports/channel.repository';
import {
  ChannelNotConfiguredError,
  type MessagingProvider,
  type MessagingProviderRegistry,
  type SendMessageRequest,
} from './ports/messaging-provider.port';

class FakeProvider implements MessagingProvider {
  readonly requests: SendMessageRequest[] = [];
  error: Error | null = null;

  async send(request: SendMessageRequest) {
    this.requests.push(request);
    if (this.error) throw this.error;
    return { providerMessageId: `prov-${request.messageId}` };
  }
}

const channel: ChannelForSend = {
  id: 'c1',
  provider: 'N8N',
  externalId: 'pnid-1',
  webhookUrl: 'https://n8n.example.com/webhook/send',
  hmacSecretEnc: new Uint8Array([1]),
};

/** Registro de un solo canal (`c1`) con el proveedor falso. */
class FakeRegistry implements MessagingProviderRegistry {
  constructor(private readonly provider: MessagingProvider) {}

  async resolve(_tenantId: string, channelId: string) {
    return channelId === channel.id ? { provider: this.provider, channel } : null;
  }
}

describe('DispatchOutboundMessageUseCase', () => {
  let conversations: InMemoryConversations;
  let provider: FakeProvider;
  let useCase: DispatchOutboundMessageUseCase;
  let messageId: string;
  let metrics: NoopMetrics;

  beforeEach(async () => {
    conversations = new InMemoryConversations();
    provider = new FakeProvider();
    metrics = new NoopMetrics();
    useCase = new DispatchOutboundMessageUseCase(
      new FindOutboundForSendUseCase(conversations),
      new UpdateDeliveryStatusUseCase(
        noTransaction,
        conversations,
        new InMemoryEventInbox(),
        new InMemoryOutbox(),
      ),
      new FakeRegistry(provider),
      undefined,
      metrics,
    );
    const conversation = await conversations.createOpen({
      tenantId: 't1',
      channelId: 'c1',
      contactId: 'k1',
      at: new Date(),
      preview: 'Hola',
    });
    conversations.phones.set(conversation.id, '+573001110001');
    messageId = (
      await conversations.appendMessage(
        conversation,
        agentMessage('Hola', 'laura', 'client-1'),
        new Date(),
      )
    ).id;
  });

  it('envía al proveedor con el destinatario y marca SENT con el providerMessageId', async () => {
    await useCase.send('t1', { messageId });

    expect(provider.requests).toEqual([
      {
        tenantId: 't1',
        channel,
        conversationId: conversations.messages[0]!.conversationId,
        messageId,
        to: '+573001110001',
        text: 'Hola',
        attachment: null,
      },
    ]);
    expect(conversations.messages[0]).toMatchObject({
      status: 'SENT',
      externalId: `prov-${messageId}`,
    });
  });

  it('si el proveedor falla lanza el error y deja el mensaje PENDING', async () => {
    provider.error = new Error('proveedor caído');

    await expect(useCase.send('t1', { messageId })).rejects.toThrow('proveedor caído');
    expect(conversations.messages[0]!.status).toBe('PENDING');
  });

  it('un canal sin configurar deja el mensaje FAILED (CHANNEL_NOT_CONFIGURED) sin lanzar', async () => {
    provider.error = new ChannelNotConfiguredError('sin secreto');

    await useCase.send('t1', { messageId });

    expect(conversations.messages[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'CHANNEL_NOT_CONFIGURED',
    });
  });

  it('no reenvía un mensaje que ya no está PENDING', async () => {
    conversations.messages[0]!.status = 'DELIVERED';

    await useCase.send('t1', { messageId });

    expect(provider.requests).toHaveLength(0);
  });

  it('descarta el envío de un mensaje que ya no existe', async () => {
    await useCase.send('t1', { messageId: '0199c0de-0000-7000-8000-0000000000ff' });

    expect(provider.requests).toHaveLength(0);
  });

  it('fail deja el mensaje FAILED con el motivo', async () => {
    await useCase.fail('t1', { messageId }, 'proveedor caído');

    expect(conversations.messages[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'proveedor caído',
    });
  });

  it('un reintento manual (FAILED → PENDING) vuelve a SENT', async () => {
    await useCase.fail('t1', { messageId }, 'proveedor caído');
    conversations.messages[0]!.status = 'PENDING';

    await useCase.send('t1', { messageId });

    expect(conversations.messages[0]).toMatchObject({ status: 'SENT', failureReason: null });
  });

  describe('métricas', () => {
    it('cuenta un intento con éxito por envío', async () => {
      const attempt = vi.spyOn(metrics, 'messageSendAttempt');

      await useCase.send('t1', { messageId });

      expect(attempt).toHaveBeenCalledExactlyOnceWith('N8N', 'success');
    });

    it('cuenta un intento fallido cuando el proveedor falla, sin marcar FAILED', async () => {
      const attempt = vi.spyOn(metrics, 'messageSendAttempt');
      const failed = vi.spyOn(metrics, 'messageFailed');
      provider.error = new Error('proveedor caído');

      await expect(useCase.send('t1', { messageId })).rejects.toThrow();

      expect(attempt).toHaveBeenCalledExactlyOnceWith('N8N', 'failure');
      expect(failed).not.toHaveBeenCalled();
    });

    it('cuenta el mensaje fallido una sola vez aunque fail se repita', async () => {
      const failed = vi.spyOn(metrics, 'messageFailed');

      await useCase.fail('t1', { messageId }, 'proveedor caído');
      await useCase.fail('t1', { messageId }, 'proveedor caído');

      expect(failed).toHaveBeenCalledExactlyOnceWith('N8N');
    });

    it('un canal sin configurar cuenta un intento fallido y un mensaje fallido', async () => {
      const attempt = vi.spyOn(metrics, 'messageSendAttempt');
      const failed = vi.spyOn(metrics, 'messageFailed');
      provider.error = new ChannelNotConfiguredError('sin secreto');

      await useCase.send('t1', { messageId });

      expect(attempt).toHaveBeenCalledExactlyOnceWith('N8N', 'failure');
      expect(failed).toHaveBeenCalledExactlyOnceWith('N8N');
    });
  });
});
