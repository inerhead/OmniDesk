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
  UnauthorizedException,
  ForbiddenException,
  HttpCode,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';
import { OUTBOX_PORT, type OutboxPort } from '../../shared/application/outbox.port';
import { sha256Hex } from '../../shared/infrastructure/crypto/sha256';
import { RegisterInboundMessageUseCase } from '../conversations/application/register-inbound-message.use-case';
import { UpdateDeliveryStatusUseCase } from '../conversations/application/update-delivery-status.use-case';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from '../conversations/application/ports/conversation.repository';
import { parseWhatsAppEvents, verifyMetaSignature } from './whatsapp-protocol';
import { WhatsAppSettings } from './whatsapp-settings';

@Controller({ path: 'integrations/whatsapp', version: '1' })
export class WhatsAppWebhookController {
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    private readonly inbound: RegisterInboundMessageUseCase,
    private readonly delivery: UpdateDeliveryStatusUseCase,
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
    const channel = await this.settings.find(id);
    if (
      !channel?.whatsappAppSecretEnc ||
      !req.rawBody ||
      !verifyMetaSignature(
        req.rawBody,
        req.header('x-hub-signature-256'),
        this.cipher.decrypt(channel.whatsappAppSecretEnc),
      )
    )
      throw new UnauthorizedException('Firma de Meta inválida');
    const integration = { tenantId: channel.tenantId, channelId: channel.id };
    let needsRetry = false;
    for (const event of parseWhatsAppEvents(req.body, channel.externalId)) {
      if (event.kind === 'inbound') {
        await this.inbound.execute(integration, event, async (result) => {
          if (
            !result.duplicate &&
            result.aiAllowed &&
            channel.aiEnabled &&
            channel.webhookUrl &&
            channel.hmacSecretEnc
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
