import { Inject, Injectable, Logger } from '@nestjs/common';
import { FindOutboundForSendUseCase } from '../../conversations/application/find-outbound-for-send.use-case';
import { SendRequestedPayloadSchema } from '../../conversations/application/enqueue-send-requested';
import { UpdateDeliveryStatusUseCase } from '../../conversations/application/update-delivery-status.use-case';
import { MESSAGING_PROVIDER, type MessagingProvider } from './ports/messaging-provider.port';

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
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
  ) {}

  /** Envía el mensaje y lo marca `SENT`. Lanza si el proveedor falla. */
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

    const { providerMessageId } = await this.provider.send({
      tenantId,
      channelId: message.channelId,
      messageId: message.id,
      to: outbound.to,
      text: message.text,
    });
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
    await this.deliveryStatus.applyInternal(
      { tenantId, channelId: outbound.message.channelId },
      {
        messageId,
        status: 'FAILED',
        occurredAt: new Date(),
        error: reason.slice(0, 500),
      },
    );
  }
}
