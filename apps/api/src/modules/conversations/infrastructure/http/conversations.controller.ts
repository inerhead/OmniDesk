import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { ListConversationsResponse, ListMessagesResponse } from '@omnidesk/contracts';
import type { TenantContext } from '../../../../shared/application/request-context';
import { CurrentTenant } from '../../../../shared/infrastructure/http/request-context.decorators';
import { DemoTenantGuard } from '../../../demo/infrastructure/http/demo-tenant.guard';
import { InvalidCursorError } from '../../application/conversation-cursor';
import { ListConversationsUseCase } from '../../application/list-conversations.use-case';
import { ListMessagesUseCase } from '../../application/list-messages.use-case';
import {
  ListConversationsQueryDto,
  ListConversationsResponseDto,
  ListMessagesQueryDto,
  ListMessagesResponseDto,
} from './conversations.dto';

/** Lectura de la bandeja. Sin login todavía: el tenant lo resuelve DemoTenantGuard (solo DEMO_MODE=true). */
@ApiTags('conversations')
@ApiUnauthorizedResponse({
  description: 'DEMO_MODE desactivado: la lectura requiere autenticación.',
})
@UseGuards(DemoTenantGuard)
@Controller({ path: 'conversations', version: '1' })
export class ConversationsController {
  constructor(
    private readonly listConversations: ListConversationsUseCase,
    private readonly listMessages: ListMessagesUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: ListConversationsResponseDto.Output })
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ListConversationsResponse> {
    try {
      const page = await this.listConversations.execute(tenant, query.cursor, query.limit);
      return {
        items: page.items.map((item) => ({
          ...item,
          lastMessageAt: item.lastMessageAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get(':id/messages')
  @ApiOkResponse({ type: ListMessagesResponseDto.Output })
  @ApiNotFoundResponse({ description: 'La conversación no existe en el tenant.' })
  async messages(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<ListMessagesResponse> {
    const page = await this.listMessages.execute(tenant, id, query.before, query.limit);
    if (!page) throw new NotFoundException('Conversación no encontrada');
    return {
      items: page.items.map(({ conversationId: _conversationId, ...message }) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
      prevCursor: page.prevCursor,
    };
  }
}
