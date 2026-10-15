import {
  Body,
  Controller,
  HttpStatus,
  NotFoundException,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { OutboundAiMessageRejected, OutboundAiMessageResponse } from '@omnidesk/contracts';
import type { Response } from 'express';
import type { IntegrationContext } from '../../../../shared/application/request-context';
import { CurrentIntegration } from '../../../../shared/infrastructure/http/request-context.decorators';
import { ChannelCredentialGuard } from '../../../channels/infrastructure/http/channel-credential.guard';
import { IntegrationMetricsInterceptor } from './integration-metrics.interceptor';
import { RegisterAiReplyUseCase } from '../../../conversations/application/register-ai-reply.use-case';
import {
  OutboundAiMessageRejectedDto,
  OutboundAiMessageRequestDto,
  OutboundAiMessageResponseDto,
} from './integration.dto';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(ChannelCredentialGuard)
@UseInterceptors(IntegrationMetricsInterceptor)
@Controller({ path: 'integrations/messages', version: '1' })
export class OutboundMessagesController {
  constructor(private readonly registerAiReply: RegisterAiReplyUseCase) {}

  @Post('outbound')
  @ApiCreatedResponse({
    type: OutboundAiMessageResponseDto.Output,
    description: 'Respuesta de IA registrada como PENDING: la integración puede enviarla.',
  })
  @ApiConflictResponse({
    type: OutboundAiMessageRejectedDto.Output,
    description:
      'El control cambió, la conversación está cerrada, venció la ventana de 18 h (`WINDOW_CLOSED`) o la empresa está inactiva (`TENANT_INACTIVE`): la integración NO debe enviar el mensaje.',
  })
  @ApiNotFoundResponse({ description: 'La conversación no existe en el canal de la credencial.' })
  @ApiUnauthorizedResponse({ description: 'Credencial de integración ausente o inválida.' })
  async outbound(
    @CurrentIntegration() integration: IntegrationContext,
    @Body() body: OutboundAiMessageRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OutboundAiMessageResponse | OutboundAiMessageRejected> {
    const result = await this.registerAiReply.execute(integration, body);

    switch (result.kind) {
      case 'not-found':
        throw new NotFoundException('Conversación no encontrada');
      case 'rejected':
        res.status(HttpStatus.CONFLICT);
        return { sendAllowed: false, reason: result.reason };
      case 'accepted':
        res.status(HttpStatus.CREATED);
        return { messageId: result.messageId, sendAllowed: true };
    }
  }
}
