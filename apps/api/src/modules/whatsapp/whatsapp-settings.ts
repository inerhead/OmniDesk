import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ConfigureWhatsAppRequestSchema, type ConfigureWhatsAppRequest } from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext } from '../../shared/application/request-context';
import { PrismaDb } from '../../shared/infrastructure/prisma/prisma-transaction-runner';
import { sha256Hex } from '../../shared/infrastructure/crypto/sha256';
import { Actor } from '../../shared/infrastructure/http/request-context.decorators';
import { OriginGuard } from '../../shared/infrastructure/http/origin.guard';
import { SessionGuard } from '../identity/infrastructure/http/session.guard';
import { canManageChannels } from '../channels/domain/channel-policy';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';

@Injectable()
export class WhatsAppSettings {
  constructor(
    private readonly db: PrismaDb,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
  ) {}

  /** Con la empresa en borrado (SPEC 20), el canal cuenta como desconocido. */
  find(channelId: string, tenantId?: string) {
    return this.db.client.channel.findFirst({
      where: {
        id: channelId,
        ...(tenantId && { tenantId }),
        provider: 'WHATSAPP_CLOUD',
        tenant: { deletionRequestedAt: null },
      },
    });
  }

  async configure(actor: ActorContext, channelId: string, input: ConfigureWhatsAppRequest) {
    if (!canManageChannels(actor.role))
      throw new ForbiddenException('Solo OWNER y ADMIN gestionan canales');
    const channel = await this.find(channelId, actor.tenantId);
    if (!channel) throw new NotFoundException('Canal no encontrado');
    if (
      input.aiEnabled &&
      (!channel.webhookUrl || !channel.n8nClientId || !channel.n8nClientSecretEnc)
    ) {
      throw new BadRequestException(
        'Configura el webhook de IA y las credenciales de cliente antes de activarla',
      );
    }
    await this.db.client.channel.update({
      where: { id: channelId, tenantId: actor.tenantId },
      data: {
        ...(input.accessToken !== undefined && {
          whatsappAccessTokenEnc: this.cipher.encrypt(input.accessToken),
        }),
        ...(input.appSecret !== undefined && {
          whatsappAppSecretEnc: this.cipher.encrypt(input.appSecret),
        }),
        ...(input.verifyToken !== undefined && {
          whatsappVerifyTokenHash: sha256Hex(input.verifyToken),
        }),
        ...(input.aiEnabled !== undefined && { aiEnabled: input.aiEnabled }),
      },
    });
    return { ok: true };
  }
}
class ConfigureWhatsAppDto extends createZodDto(ConfigureWhatsAppRequestSchema) {}
@Controller({ path: 'channels', version: '1' })
@UseGuards(OriginGuard, SessionGuard)
export class WhatsAppSettingsController {
  constructor(private readonly settings: WhatsAppSettings) {}
  @Patch(':id/whatsapp')
  configure(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConfigureWhatsAppDto,
  ) {
    return this.settings.configure(actor, id, body);
  }
}
