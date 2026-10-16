import {
  Body,
  Inject,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ChannelSchema,
  ChannelTestResponseSchema,
  CreateChannelRequestSchema,
  ListChannelsResponseSchema,
  ListInboxChannelsResponseSchema,
  N8nClientCredentialsResponseSchema,
  UpdateChannelRequestSchema,
  type Channel,
  type ChannelTestResponse,
  type ListChannelsResponse,
  type ListInboxChannelsResponse,
  type N8nClientCredentialsResponse,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import { ENV, type Env } from '../../../../shared/config/env';
import type { ActorContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import {
  CreateChannelUseCase,
  GenerateN8nClientSecretUseCase,
  ListChannelsUseCase,
  ListInboxChannelsUseCase,
  RemoveN8nClientUseCase,
  TestChannelConnectionUseCase,
  UpdateChannelUseCase,
} from '../../application/channels.use-cases';
import type { ChannelSummary } from '../../domain/channel';
import { WEBHOOK_URL_MESSAGES, type WebhookUrlCheck } from '../../domain/channel-policy';

class ChannelDto extends createZodDto(ChannelSchema) {}
class ListChannelsResponseDto extends createZodDto(ListChannelsResponseSchema) {}
class ListInboxChannelsResponseDto extends createZodDto(ListInboxChannelsResponseSchema) {}
class CreateChannelRequestDto extends createZodDto(CreateChannelRequestSchema) {}
class UpdateChannelRequestDto extends createZodDto(UpdateChannelRequestSchema) {}
class N8nClientCredentialsResponseDto extends createZodDto(N8nClientCredentialsResponseSchema) {}
class ChannelTestResponseDto extends createZodDto(ChannelTestResponseSchema) {}

function toChannel(channel: ChannelSummary, appUrl: string): Channel {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    provider: channel.provider,
    phoneNumber: channel.phoneNumber,
    externalId: channel.externalId,
    webhookUrl: channel.webhookUrl,
    aiEnabled: channel.aiEnabled ?? false,
    hasWhatsAppCredentials: channel.hasWhatsAppCredentials ?? false,
    hasN8nClientSecret: channel.hasN8nClientSecret,
    whatsappWebhookUrl:
      channel.provider === 'WHATSAPP_CLOUD'
        ? `${appUrl.replace(/\/$/, '')}/api/v1/integrations/whatsapp/${channel.id}`
        : null,
    credentialsRotatedAt: channel.credentialsRotatedAt?.toISOString() ?? null,
  };
}

const FORBIDDEN = 'Solo OWNER y ADMIN gestionan canales';

function invalidWebhook(reason: Exclude<WebhookUrlCheck, { ok: true }>['reason']) {
  return apiError(HttpStatus.BAD_REQUEST, 'INVALID_WEBHOOK_URL', WEBHOOK_URL_MESSAGES[reason]);
}

/** Canales de la empresa activa (SPEC 09): alta, edición, credenciales de cliente de n8n (SPEC 22) y prueba de conexión. */
@ApiTags('channels')
@UseGuards(OriginGuard, SessionGuard)
@ApiForbiddenResponse({ description: 'Solo OWNER y ADMIN.' })
@Controller({ path: 'channels', version: '1' })
export class ChannelsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly listChannels: ListChannelsUseCase,
    private readonly listInboxChannels: ListInboxChannelsUseCase,
    private readonly createChannel: CreateChannelUseCase,
    private readonly updateChannel: UpdateChannelUseCase,
    private readonly testConnection: TestChannelConnectionUseCase,
    private readonly generateN8nClientSecret: GenerateN8nClientSecretUseCase,
    private readonly removeN8nClient: RemoveN8nClientUseCase,
  ) {}

  @Get('inbox')
  @ApiOkResponse({
    type: ListInboxChannelsResponseDto.Output,
    description: 'Id, nombre y tipo. Cualquier miembro de la empresa.',
  })
  async inbox(@Actor() actor: ActorContext): Promise<ListInboxChannelsResponse> {
    return { items: await this.listInboxChannels.execute(actor) };
  }

  @Get()
  @ApiOkResponse({ type: ListChannelsResponseDto.Output, description: 'Sin secretos.' })
  async list(@Actor() actor: ActorContext): Promise<ListChannelsResponse> {
    const result = await this.listChannels.execute(actor);
    if (result.kind === 'forbidden') throw new ForbiddenException(FORBIDDEN);
    return { items: result.items.map((channel) => toChannel(channel, this.env.APP_URL)) };
  }

  @Post()
  @ApiCreatedResponse({ type: ChannelDto.Output, description: 'Canal creado, sin credenciales.' })
  @ApiConflictResponse({ description: 'Ese `externalId` ya existe (`CHANNEL_EXTERNAL_ID_TAKEN`).' })
  async create(
    @Actor() actor: ActorContext,
    @Body() body: CreateChannelRequestDto,
  ): Promise<Channel> {
    const result = await this.createChannel.execute(actor, body);
    switch (result.kind) {
      case 'forbidden':
        throw new ForbiddenException(FORBIDDEN);
      case 'conflict':
        throw apiError(
          HttpStatus.CONFLICT,
          'CHANNEL_EXTERNAL_ID_TAKEN',
          'Ya hay un canal con ese phone_number_id',
        );
      case 'ok':
        return toChannel(result.channel, this.env.APP_URL);
    }
  }

  @Patch(':id')
  @ApiOkResponse({ type: ChannelDto.Output })
  @ApiBadRequestResponse({ description: '`webhookUrl` no permitido (`INVALID_WEBHOOK_URL`).' })
  @ApiNotFoundResponse({ description: 'El canal no existe en la empresa.' })
  async update(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateChannelRequestDto,
  ): Promise<Channel> {
    const result = await this.updateChannel.execute(actor, id, body);
    switch (result.kind) {
      case 'forbidden':
        throw new ForbiddenException(FORBIDDEN);
      case 'not-found':
        throw new NotFoundException('Canal no encontrado');
      case 'invalid-webhook':
        throw invalidWebhook(result.reason);
      case 'ok':
        return toChannel(result.channel, this.env.APP_URL);
    }
  }

  /** Genera (o regenera) el secreto de cliente de n8n; el `clientId` es el id del canal (SPEC 22). */
  @Post(':id/n8n-client')
  @ApiCreatedResponse({
    type: N8nClientCredentialsResponseDto.Output,
    description: 'Client ID y secreto nuevo. El secreto solo aparece en esta respuesta.',
  })
  @ApiNotFoundResponse({ description: 'El canal no existe en la empresa.' })
  async postN8nClient(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<N8nClientCredentialsResponse> {
    const result = await this.generateN8nClientSecret.execute(actor, id);
    if (result.kind === 'forbidden') throw new ForbiddenException(FORBIDDEN);
    if (result.kind === 'not-found') throw new NotFoundException('Canal no encontrado');
    return result.credentials;
  }

  /** Quita el secreto de cliente y apaga la IA. Repetirlo responde 200 sin cambios. */
  @Delete(':id/n8n-client')
  @ApiOkResponse({ type: ChannelDto.Output, description: 'Canal sin secreto de cliente y sin IA.' })
  @ApiNotFoundResponse({ description: 'El canal no existe en la empresa.' })
  async deleteN8nClient(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Channel> {
    const result = await this.removeN8nClient.execute(actor, id);
    if (result.kind === 'forbidden') throw new ForbiddenException(FORBIDDEN);
    if (result.kind === 'not-found') throw new NotFoundException('Canal no encontrado');
    return toChannel(result.channel, this.env.APP_URL);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: ChannelTestResponseDto.Output,
    description: '`ping` al webhook con las credenciales de cliente.',
  })
  @ApiNotFoundResponse({ description: 'El canal no existe en la empresa.' })
  async test(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ChannelTestResponse> {
    const result = await this.testConnection.execute(actor, id);
    if (result.kind === 'forbidden') throw new ForbiddenException(FORBIDDEN);
    if (result.kind === 'not-found') throw new NotFoundException('Canal no encontrado');
    return result.result;
  }
}
