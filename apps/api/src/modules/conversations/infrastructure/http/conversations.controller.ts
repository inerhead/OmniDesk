import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type {
  ConversationCommandResponse,
  ConversationSummary as ConversationSummaryResponse,
  ListConversationsResponse,
  ListMessagesResponse,
  ListTimelineResponse,
  Message as MessageResponse,
  SendAgentMessageResponse,
} from '@omnidesk/contracts';
import type { Response } from 'express';
import type { ActorContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { AssignConversationUseCase } from '../../application/assign-conversation.use-case';
import { CloseConversationUseCase } from '../../application/close-conversation.use-case';
import { InvalidCursorError } from '../../application/conversation-cursor';
import type { CommandResult } from '../../application/conversation-command-runner';
import type { ConversationSummary } from '../../application/conversation-summary';
import { GetConversationSummaryUseCase } from '../../application/get-conversation-summary.use-case';
import { InboxForbiddenError } from '../../application/inbox-filter';
import { ListConversationsUseCase } from '../../application/list-conversations.use-case';
import { ListMessagesUseCase } from '../../application/list-messages.use-case';
import { ListTimelineUseCase } from '../../application/list-timeline.use-case';
import { ReleaseConversationUseCase } from '../../application/release-conversation.use-case';
import { ReopenConversationUseCase } from '../../application/reopen-conversation.use-case';
import { RetryFailedMessageUseCase } from '../../application/retry-failed-message.use-case';
import { SendAgentMessageUseCase } from '../../application/send-agent-message.use-case';
import type { Message } from '../../domain/message';
import {
  AssignConversationRequestDto,
  ConversationCommandRejectedDto,
  ConversationCommandRequestDto,
  ConversationCommandResponseDto,
  ConversationSummaryDto,
  ListConversationsQueryDto,
  ListConversationsResponseDto,
  ListMessagesQueryDto,
  ListMessagesResponseDto,
  ListTimelineQueryDto,
  ListTimelineResponseDto,
  SendAgentMessageRequestDto,
  SendAgentMessageResponseDto,
} from './conversations.dto';

function toSummaryDto(summary: ConversationSummary): ConversationSummaryResponse {
  return {
    ...summary,
    lastMessageAt: summary.lastMessageAt.toISOString(),
    createdAt: summary.createdAt.toISOString(),
  };
}

function toMessageDto(message: Message): MessageResponse {
  return {
    id: message.id,
    sequence: message.sequence,
    direction: message.direction,
    senderType: message.senderType,
    text: message.text,
    status: message.status,
    sender: message.sender,
    failureReason: message.failureReason,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * Bandeja y comandos de conversaciones. El tenant y el actor salen de la sesión (`SessionGuard`):
 * la empresa activa y la membresía del usuario en ella.
 */
@ApiTags('conversations')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@ApiForbiddenResponse({
  description: 'Sin empresa activa (`NO_ACTIVE_TENANT`) u Origin no permitido.',
})
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'conversations', version: '1' })
export class ConversationsController {
  constructor(
    private readonly listConversations: ListConversationsUseCase,
    private readonly listMessages: ListMessagesUseCase,
    private readonly listTimeline: ListTimelineUseCase,
    private readonly getSummary: GetConversationSummaryUseCase,
    private readonly assignConversation: AssignConversationUseCase,
    private readonly releaseConversation: ReleaseConversationUseCase,
    private readonly closeConversation: CloseConversationUseCase,
    private readonly reopenConversation: ReopenConversationUseCase,
    private readonly sendAgentMessage: SendAgentMessageUseCase,
    private readonly retryFailedMessage: RetryFailedMessageUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: ListConversationsResponseDto.Output })
  @ApiForbiddenResponse({
    description: 'Tu rol no puede ver esa bandeja (`all` es de OWNER/ADMIN).',
  })
  async list(
    @Actor() actor: ActorContext,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ListConversationsResponse> {
    try {
      const page = await this.listConversations.execute(
        actor,
        query.inbox,
        query.cursor,
        query.limit,
        query.q,
        query.channelId,
      );
      return { items: page.items.map(toSummaryDto), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new BadRequestException(error.message);
      if (error instanceof InboxForbiddenError) throw new ForbiddenException(error.message);
      throw error;
    }
  }

  @Get(':id')
  @ApiOkResponse({ type: ConversationSummaryDto.Output })
  @ApiNotFoundResponse({ description: 'La conversación no existe o el actor no puede verla.' })
  async detail(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConversationSummaryResponse> {
    const summary = await this.getSummary.execute(actor, id);
    if (!summary) throw new NotFoundException('Conversación no encontrada');
    return toSummaryDto(summary);
  }

  @Get(':id/messages')
  @ApiOkResponse({ type: ListMessagesResponseDto.Output })
  @ApiNotFoundResponse({ description: 'La conversación no existe o el actor no puede verla.' })
  async messages(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<ListMessagesResponse> {
    const page = await this.listMessages.execute(actor, id, query.before, query.limit);
    if (!page) throw new NotFoundException('Conversación no encontrada');
    return {
      items: page.items.map(toMessageDto),
      prevCursor: page.prevCursor,
    };
  }

  @Get(':id/timeline')
  @ApiOkResponse({ type: ListTimelineResponseDto.Output })
  @ApiNotFoundResponse({ description: 'La conversación no existe o el actor no puede verla.' })
  async timeline(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListTimelineQueryDto,
  ): Promise<ListTimelineResponse> {
    const page = await this.listTimeline.execute(actor, id, query.before, query.limit);
    if (!page) throw new NotFoundException('Conversación no encontrada');
    return {
      items: page.items.map((item) => {
        if (item.kind === 'event') {
          return { ...item, createdAt: item.createdAt.toISOString() };
        }
        return { kind: 'message' as const, ...toMessageDto(item) };
      }),
      prevCursor: page.prevCursor,
    };
  }

  @Post(':id/messages')
  @ApiCreatedResponse({
    type: SendAgentMessageResponseDto.Output,
    description: 'Mensaje registrado como PENDING; el Outbox lo envía al proveedor.',
  })
  @ApiOkResponse({
    type: SendAgentMessageResponseDto.Output,
    description: 'Idempotente: el `clientMessageId` ya estaba registrado.',
  })
  @ApiConflictResponse({ description: 'La conversación está cerrada (`INVALID_STATE`).' })
  @ApiForbiddenResponse({ description: 'Solo escribe el agente asignado.' })
  @ApiNotFoundResponse({ description: 'La conversación no existe o no puedes verla.' })
  async send(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SendAgentMessageRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SendAgentMessageResponse> {
    const result = await this.sendAgentMessage.execute(actor, {
      conversationId: id,
      text: body.text,
      clientMessageId: body.clientMessageId,
    });
    switch (result.kind) {
      case 'not-found':
        throw new NotFoundException('Conversación no encontrada');
      case 'forbidden':
        throw new ForbiddenException('Solo el agente asignado puede responder');
      case 'rejected':
        throw new ConflictException({ reason: result.reason });
      case 'ok':
        res.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
        return toMessageDto(result.message);
    }
  }

  @Post(':id/messages/:messageId/retry')
  @HttpCode(200)
  @ApiOkResponse({ type: SendAgentMessageResponseDto.Output })
  @ApiConflictResponse({ description: 'El mensaje no está en FAILED (`INVALID_STATE`).' })
  @ApiForbiddenResponse({ description: 'Solo reintenta el agente asignado.' })
  @ApiNotFoundResponse({
    description: 'La conversación o el mensaje no existen, o no puedes verla.',
  })
  async retry(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ): Promise<SendAgentMessageResponse> {
    const result = await this.retryFailedMessage.execute(actor, {
      conversationId: id,
      messageId,
    });
    switch (result.kind) {
      case 'not-found':
        throw new NotFoundException('Mensaje no encontrado');
      case 'forbidden':
        throw new ForbiddenException('Solo el agente asignado puede reintentar');
      case 'rejected':
        throw new ConflictException({ reason: result.reason });
      case 'ok':
        return toMessageDto(result.message);
    }
  }

  @Post(':id/assign')
  @HttpCode(200)
  @ApiOkResponse({ type: ConversationCommandResponseDto.Output })
  @ApiConflictResponse({ type: ConversationCommandRejectedDto.Output })
  @ApiForbiddenResponse({ description: 'Tu rol no permite esta acción.' })
  @ApiNotFoundResponse({
    description: 'La conversación o el miembro no existen, o no puedes verla.',
  })
  async assign(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AssignConversationRequestDto,
  ): Promise<ConversationCommandResponse> {
    const result = await this.assignConversation.execute(actor, {
      conversationId: id,
      memberId: body.memberId,
      controlVersion: body.controlVersion,
    });
    return this.respond(actor, id, result);
  }

  @Post(':id/release')
  @HttpCode(200)
  @ApiOkResponse({ type: ConversationCommandResponseDto.Output })
  @ApiConflictResponse({ type: ConversationCommandRejectedDto.Output })
  @ApiForbiddenResponse({ description: 'Tu rol no permite esta acción.' })
  @ApiNotFoundResponse({ description: 'La conversación no existe o no puedes verla.' })
  async release(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConversationCommandRequestDto,
  ): Promise<ConversationCommandResponse> {
    const result = await this.releaseConversation.execute(actor, {
      conversationId: id,
      controlVersion: body.controlVersion,
    });
    return this.respond(actor, id, result);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOkResponse({ type: ConversationCommandResponseDto.Output })
  @ApiConflictResponse({ type: ConversationCommandRejectedDto.Output })
  @ApiForbiddenResponse({ description: 'Tu rol no permite esta acción.' })
  @ApiNotFoundResponse({ description: 'La conversación no existe o no puedes verla.' })
  async close(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConversationCommandRequestDto,
  ): Promise<ConversationCommandResponse> {
    const result = await this.closeConversation.execute(actor, {
      conversationId: id,
      controlVersion: body.controlVersion,
    });
    return this.respond(actor, id, result);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @ApiOkResponse({ type: ConversationCommandResponseDto.Output })
  @ApiConflictResponse({ type: ConversationCommandRejectedDto.Output })
  @ApiForbiddenResponse({ description: 'Tu rol no permite esta acción.' })
  @ApiNotFoundResponse({ description: 'La conversación no existe o no puedes verla.' })
  async reopen(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConversationCommandRequestDto,
  ): Promise<ConversationCommandResponse> {
    const result = await this.reopenConversation.execute(actor, {
      conversationId: id,
      controlVersion: body.controlVersion,
    });
    return this.respond(actor, id, result);
  }

  /** Traduce el resultado del comando a HTTP; si salió bien, devuelve el estado actual. */
  private async respond(
    actor: ActorContext,
    id: string,
    result: CommandResult,
  ): Promise<ConversationCommandResponse> {
    switch (result.kind) {
      case 'not-found':
        throw new NotFoundException('Conversación no encontrada');
      case 'member-not-found':
        throw new NotFoundException('Miembro no encontrado');
      case 'forbidden':
        throw new ForbiddenException('Tu rol no permite esta acción');
      case 'rejected':
        throw new ConflictException({ reason: result.reason });
      case 'ok': {
        const summary = await this.getSummary.execute(actor, id);
        if (!summary) throw new NotFoundException('Conversación no encontrada');
        return toSummaryDto(summary);
      }
    }
  }
}
