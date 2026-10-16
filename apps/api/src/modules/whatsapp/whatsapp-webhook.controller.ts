import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  Inject,
  ForbiddenException,
  NotFoundException,
  HttpCode,
  ServiceUnavailableException,
  Logger,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { OUTBOX_PORT, type OutboxPort } from '../../shared/application/outbox.port';
import { sha256Hex } from '../../shared/infrastructure/crypto/sha256';
import { enqueueAttachmentDownload } from '../attachments/application/enqueue-attachment-download';
import { RegisterInboundMessageUseCase } from '../conversations/application/register-inbound-message.use-case';
import { UpdateDeliveryStatusUseCase } from '../conversations/application/update-delivery-status.use-case';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from '../conversations/application/ports/conversation.repository';
import { parseWhatsAppEvents, describeWhatsAppWebhook } from './whatsapp-protocol';
import { TenantPrisma } from '../../shared/infrastructure/prisma/tenant-prisma';
import { WhatsAppSettings } from './whatsapp-settings';

@Controller({ path: 'integrations/whatsapp', version: '1' })
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    private readonly inbound: RegisterInboundMessageUseCase,
    private readonly delivery: UpdateDeliveryStatusUseCase,
    private readonly tenantPrisma: TenantPrisma,
  ) {}

  @Get(':id')
  async verify(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const channel = await this.settings.find(id);
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (
      !channel?.whatsappVerifyTokenHash ||
      query['hub.mode'] !== 'subscribe' ||
      typeof token !== 'string' ||
      typeof challenge !== 'string' ||
      !timingSafeEqual(Buffer.from(sha256Hex(token)), Buffer.from(channel.whatsappVerifyTokenHash))
    )
      throw new ForbiddenException('Verificación inválida');
    res.type('text/plain').send(challenge);
  }

  @Post(':id')
  @HttpCode(200)
  async receive(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: RawBodyRequest<Request>) {
    // El canal se resuelve con el rol dueño (aún no se sabe la empresa); lo demás, en su nombre.
    const channel = await this.settings.find(id);
    if (!channel) throw new NotFoundException('Canal no encontrado');
    return this.tenantPrisma.run(channel.tenantId, () => this.process(id, channel, req.body));
  }

  private async process(
    id: string,
    channel: NonNullable<Awaited<ReturnType<WhatsAppSettings['find']>>>,
    body: unknown,
  ) {
    const integration = { tenantId: channel.tenantId, channelId: channel.id };
    let needsRetry = false;
    const events = parseWhatsAppEvents(body, channel.externalId);
    const statuses = events.filter((event) => event.kind === 'status');
    const inboundEvents = events.filter((event) => event.kind === 'inbound');
    if (statuses.length === 0 && inboundEvents.length === 0) {
      this.logger.warn(`Webhook sin estados: ${describeWhatsAppWebhook(body)}`);
      try {
        writeFileSync('/tmp/wa-last.json', JSON.stringify(body));
      } catch {
        // El diagnóstico en el log alcanza si el disco del contenedor no deja escribir.
      }
    }
    for (const event of events) {
      if (event.kind === 'inbound') {
        // Los adjuntos y los no soportados quedan para atención humana: nunca van a la IA.
        const aiEligible = !event.attachment && !event.unsupportedType;
        await this.inbound.execute(integration, event, async (result) => {
          if (result.duplicate) return;
          if (result.attachmentId)
            await enqueueAttachmentDownload(this.outbox, channel.tenantId, {
              attachmentId: result.attachmentId,
              channelId: id,
            });
          if (
            aiEligible &&
            result.aiAllowed &&
            channel.aiEnabled &&
            channel.webhookUrl &&
            channel.n8nClientSecretEnc
          ) {
            await this.outbox.enqueue({
              tenantId: channel.tenantId,
              type: 'ai.reply_requested',
              payload: {
                channelId: id,
                messageId: result.messageId,
                conversationId: result.conversationId,
                controlVersion: result.controlVersion,
                from: event.from,
                text: event.text,
              },
            });
          }
        });
      } else {
        const message = event.messageId
          ? await this.conversations.findMessageById(channel.tenantId, event.messageId)
          : await this.conversations.findMessageByExternalId(id, event.providerMessageId);
        // Sin correlación local puede ser un envío externo/anterior: no bloquear el lote.
        // Con id local puede estar en carrera con el envío; reintentar tras guardar los inbound.
        if (!message) {
          this.logger.warn(`Estado ${event.status} sin mensaje local`);
          if (event.messageId) needsRetry = true;
          continue;
        }
        if (message.channelId !== id) continue;
        await this.delivery.execute(integration, {
          messageId: message.id,
          providerMessageId: event.providerMessageId,
          status: event.status,
          occurredAt: event.occurredAt,
        });
      }
    }
    if (needsRetry) throw new ServiceUnavailableException('Mensaje aún no registrado');
    return { ok: true };
  }
}
