import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EnqueueNotificationUseCase } from '../../notifications/application/enqueue-notification.use-case';
import { FindOutboundForSendUseCase } from '../../conversations/application/find-outbound-for-send.use-case';
import { SendRequestedPayloadSchema } from '../../conversations/application/enqueue-send-requested';
import { UpdateDeliveryStatusUseCase } from '../../conversations/application/update-delivery-status.use-case';
import { METRICS, type Metrics } from '../../../shared/application/metrics.port';
import {
  ChannelNotConfiguredError,
  MESSAGING_PROVIDER_REGISTRY,
  type MessagingProviderRegistry,
} from './ports/messaging-provider.port';

/**
 * Entrega al proveedor un mensaje saliente (`message.send_requested`). Lo llama el dispatcher
 * del Outbox, que decide los reintentos.
 */
@Injectable()
export class DispatchOutboundMessageUseCase {
  private readonly logger = new Logger(DispatchOutboundMessageUseCase.name);

  constructor(
    private readonly findOutbound: FindOutboundForSendUseCase,
    private readonly deliveryStatus: UpdateDeliveryStatusUseCase,
    @Inject(MESSAGING_PROVIDER_REGISTRY) private readonly providers: MessagingProviderRegistry,
    @Optional() private readonly notifications?: EnqueueNotificationUseCase,
    @Optional() @Inject(METRICS) private readonly metrics?: Metrics,
  ) {}

  /**
   * Envía el mensaje por el adaptador de su canal y lo marca `SENT`. Lanza si el proveedor falla
   * (el dispatcher reintenta). Si el canal no puede enviar, el mensaje queda `FAILED` sin reintentos.
   */
  async send(tenantId: string, payload: unknown): Promise<void> {
    const { messageId } = SendRequestedPayloadSchema.parse(payload);
    const outbound = await this.findOutbound.execute(tenantId, messageId);
    if (!outbound) {
      this.logger.warn(`Mensaje ${messageId} no encontrado: se descarta el envío`);
      return;
    }
    // Un reintento que llega con el mensaje ya enviado (o entregado) no lo envía otra vez.
    const { message } = outbound;
    if (message.status !== 'PENDING') return;

    const resolved = await this.providers.resolve(tenantId, message.channelId);
    if (!resolved) throw new Error(`Canal ${message.channelId} no encontrado`);

    const providerName = resolved.channel.provider;
    let providerMessageId: string;
    try {
      ({ providerMessageId } = await resolved.provider.send({
        tenantId,
        channel: resolved.channel,
        conversationId: message.conversationId,
        messageId: message.id,
        to: outbound.to,
        text: message.text,
        attachment: message.attachment?.storageKey
          ? {
              kind: message.attachment.kind,
              mimeType: message.attachment.mimeType,
              fileName: message.attachment.fileName,
              storageKey: message.attachment.storageKey,
            }
          : null,
      }));
    } catch (error) {
      this.metrics?.messageSendAttempt(providerName, 'failure');
      if (!(error instanceof ChannelNotConfiguredError)) throw error;
      this.logger.warn(`Mensaje ${message.id}: ${error.message}`);
      await this.fail(tenantId, payload, error.reason);
      return;
    }
    this.metrics?.messageSendAttempt(providerName, 'success');
    await this.deliveryStatus.applyInternal(
      { tenantId, channelId: message.channelId },
      { messageId: message.id, providerMessageId, status: 'SENT', occurredAt: new Date() },
    );
  }

  /** Agotados los intentos: el mensaje pasa a `FAILED` con el motivo. */
  async fail(tenantId: string, payload: unknown, reason: string): Promise<void> {
    const { messageId } = SendRequestedPayloadSchema.parse(payload);
    const outbound = await this.findOutbound.execute(tenantId, messageId);
    if (!outbound) return;
    const result = await this.deliveryStatus.applyInternal(
      { tenantId, channelId: outbound.message.channelId },
      {
        messageId,
        status: 'FAILED',
        occurredAt: new Date(),
        error: reason.slice(0, 500),
      },
    );
    if (this.metrics && result.kind === 'ok' && result.applied) {
      const resolved = await this.providers.resolve(tenantId, outbound.message.channelId);
      this.metrics.messageFailed(resolved?.channel.provider ?? 'UNKNOWN');
    }
    await this.notifications?.requested({
      tenantId,
      kind: 'send_failed',
      conversationId: outbound.message.conversationId,
      actorMemberId: null,
      assignedAgentId: null,
      senderMemberId: outbound.message.sender?.id ?? null,
      messageId,
    });
  }
}
