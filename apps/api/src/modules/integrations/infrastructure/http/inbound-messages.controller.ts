import { Body, Controller, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { InboundMessageResponse } from '@omnidesk/contracts';
import type { Response } from 'express';
import type { IntegrationContext } from '../../../../shared/application/request-context';
import { CurrentIntegration } from '../../../../shared/infrastructure/http/request-context.decorators';
import { ChannelCredentialGuard } from '../../../channels/infrastructure/http/channel-credential.guard';
import { RegisterInboundMessageUseCase } from '../../../conversations/application/register-inbound-message.use-case';
import { InboundMessageRequestDto, InboundMessageResponseDto } from './integration.dto';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(ChannelCredentialGuard)
@Controller({ path: 'integrations/messages', version: '1' })
export class InboundMessagesController {
  constructor(private readonly registerInbound: RegisterInboundMessageUseCase) {}

  @Post('inbound')
  @ApiCreatedResponse({
    type: InboundMessageResponseDto.Output,
    description: 'Mensaje nuevo registrado.',
  })
  @ApiOkResponse({
    type: InboundMessageResponseDto.Output,
    description: 'Mensaje duplicado: ya estaba registrado.',
  })
  @ApiUnauthorizedResponse({ description: 'Credencial de integración ausente o inválida.' })
  async inbound(
    @CurrentIntegration() integration: IntegrationContext,
    @Body() body: InboundMessageRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InboundMessageResponse> {
    const result = await this.registerInbound.execute(integration, {
      ...body,
      sentAt: new Date(body.sentAt),
    });
    res.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
    return {
      conversationId: result.conversationId,
      messageId: result.messageId,
      aiAllowed: result.aiAllowed,
      controlVersion: result.controlVersion,
      duplicate: result.duplicate,
    };
  }
}
