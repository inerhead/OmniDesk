import {
  Body,
  Inject,
  Controller,
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
  ChannelCredentialsResponseSchema,
  ChannelSchema,
  ChannelTestResponseSchema,
  CreateChannelRequestSchema,
  ListChannelsResponseSchema,
  UpdateChannelRequestSchema,
  type Channel,
  type ChannelCredentialsResponse,
  type ChannelTestResponse,
  type ListChannelsResponse,
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
  IssueChannelCredentialsUseCase,
  ListChannelsUseCase,
  TestChannelConnectionUseCase,
  UpdateChannelUseCase,
} from '../../application/channels.use-cases';
import type { ChannelSummary } from '../../domain/channel';
import { WEBHOOK_URL_MESSAGES, type WebhookUrlCheck } from '../../domain/channel-policy';

class ChannelDto extends createZodDto(ChannelSchema) {}
class ListChannelsResponseDto extends createZodDto(ListChannelsResponseSchema) {}
class CreateChannelRequestDto extends createZodDto(CreateChannelRequestSchema) {}
class UpdateChannelRequestDto extends createZodDto(UpdateChannelRequestSchema) {}
class ChannelCredentialsResponseDto extends createZodDto(ChannelCredentialsResponseSchema) {}
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
    hasCredentials: channel.hasCredentials,
    aiEnabled: channel.aiEnabled ?? false,
    hasWhatsAppCredentials: channel.hasWhatsAppCredentials ?? false,
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

/** Canales de la empresa activa (SPEC 09): alta, edición, credenciales y prueba de conexión. */
@ApiTags('channels')
@UseGuards(OriginGuard, SessionGuard)
@ApiForbiddenResponse({ description: 'Solo OWNER y ADMIN.' })
@Controller({ path: 'channels', version: '1' })
export class ChannelsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly listChannels: ListChannelsUseCase,
    private readonly createChannel: CreateChannelUseCase,
    private readonly updateChannel: UpdateChannelUseCase,
    private readonly issueCredentials: IssueChannelCredentialsUseCase,
    private readonly testConnection: TestChannelConnectionUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: ListChannelsResponseDto.Output, description: 'Sin secretos.' })
  async list(@Actor() actor: ActorContext): Promise<ListChannelsResponse> {
    const result = await this.listChannels.execute(actor);
    if (result.kind === 'forbidden') throw new ForbiddenException(FORBIDDEN);
    return { items: result.items.map((channel) => toChannel(channel, this.env.APP_URL)) };
  }

  @Post()
  @ApiCreatedResponse({ type: ChannelDto.Output, description: 'Canal creado, sin credenciales.' })
  @ApiBadRequestResponse({ description: '`webhookUrl` no permitido (`INVALID_WEBHOOK_URL`).' })
  @ApiConflictResponse({ description: 'Ese `externalId` ya existe (`CHANNEL_EXTERNAL_ID_TAKEN`).' })
  async create(
    @Actor() actor: ActorContext,
    @Body() body: CreateChannelRequestDto,
  ): Promise<Channel> {
    const result = await this.createChannel.execute(actor, body);
    switch (result.kind) {
      case 'forbidden':
        throw new ForbiddenException(FORBIDDEN);
      case 'invalid-webhook':
        throw invalidWebhook(result.reason);
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

  @Post(':id/credentials')
  @ApiCreatedResponse({
    type: ChannelCredentialsResponseDto.Output,
    description: 'API key y secreto HMAC nuevos. Solo aparecen en esta respuesta.',
  })
  @ApiNotFoundResponse({ description: 'El canal no existe en la empresa.' })
  async credentials(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ChannelCredentialsResponse> {
    const result = await this.issueCredentials.execute(actor, id);
    if (result.kind === 'forbidden') throw new ForbiddenException(FORBIDDEN);
    if (result.kind === 'not-found') throw new NotFoundException('Canal no encontrado');
    return {
      apiKey: result.credentials.apiKey,
      hmacSecret: result.credentials.hmacSecret,
      previousValidUntil: result.credentials.previousValidUntil?.toISOString() ?? null,
    };
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ChannelTestResponseDto.Output, description: '`ping` firmado al webhook.' })
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
