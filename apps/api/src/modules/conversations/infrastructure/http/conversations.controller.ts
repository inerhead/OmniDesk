import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
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
} from '@omnidesk/contracts';
import type { ActorContext } from '../../../../shared/application/request-context';
import { CurrentActor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { DemoActorGuard } from '../../../demo/infrastructure/http/demo-actor.guard';
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
} from './conversations.dto';

function toSummaryDto(summary: ConversationSummary): ConversationSummaryResponse {
  return { ...summary, lastMessageAt: summary.lastMessageAt.toISOString() };
}

/**
 * Bandeja y comandos de conversaciones. Sin login todavía: el tenant y el actor los resuelve
 * DemoActorGuard (solo DEMO_MODE=true) con la cabecera `X-Demo-Member-Id`.
 */
@ApiTags('conversations')
@ApiUnauthorizedResponse({
  description: 'Sin actor demo (`X-Demo-Member-Id`) o con DEMO_MODE desactivado.',
})
@UseGuards(DemoActorGuard)
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
  ) {}

  @Get()
  @ApiOkResponse({ type: ListConversationsResponseDto.Output })
  @ApiForbiddenResponse({
    description: 'Tu rol no puede ver esa bandeja (`all` es de OWNER/ADMIN).',
  })
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ListConversationsResponse> {
    try {
      const page = await this.listConversations.execute(
        actor,
        query.inbox,
        query.cursor,
        query.limit,
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
    @CurrentActor() actor: ActorContext,
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
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<ListMessagesResponse> {
    const page = await this.listMessages.execute(actor, id, query.before, query.limit);
    if (!page) throw new NotFoundException('Conversación no encontrada');
    return {
      items: page.items.map(({ conversationId: _conversationId, ...message }) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
      prevCursor: page.prevCursor,
    };
  }

  @Get(':id/timeline')
  @ApiOkResponse({ type: ListTimelineResponseDto.Output })
  @ApiNotFoundResponse({ description: 'La conversación no existe o el actor no puede verla.' })
  async timeline(
    @CurrentActor() actor: ActorContext,
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
        return {
          kind: 'message' as const,
          id: item.id,
          sequence: item.sequence,
          direction: item.direction,
          senderType: item.senderType,
          text: item.text,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
        };
      }),
      prevCursor: page.prevCursor,
    };
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
    @CurrentActor() actor: ActorContext,
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
    @CurrentActor() actor: ActorContext,
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
    @CurrentActor() actor: ActorContext,
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
    @CurrentActor() actor: ActorContext,
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
