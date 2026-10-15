import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { DeliveryStatusResponse } from '@omnidesk/contracts';
import type { IntegrationContext } from '../../../../shared/application/request-context';
import { CurrentIntegration } from '../../../../shared/infrastructure/http/request-context.decorators';
import { ChannelCredentialGuard } from '../../../channels/infrastructure/http/channel-credential.guard';
import { IntegrationMetricsInterceptor } from './integration-metrics.interceptor';
import { UpdateDeliveryStatusUseCase } from '../../../conversations/application/update-delivery-status.use-case';
import { DeliveryStatusRequestDto, DeliveryStatusResponseDto } from './integration.dto';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(ChannelCredentialGuard)
@UseInterceptors(IntegrationMetricsInterceptor)
@Controller({ path: 'integrations/messages', version: '1' })
export class MessageStatusController {
  constructor(private readonly updateDeliveryStatus: UpdateDeliveryStatusUseCase) {}

  @Post('status')
  @HttpCode(200)
  @ApiOkResponse({
    type: DeliveryStatusResponseDto.Output,
    description: '`applied: false` si el reporte estaba repetido o llegó fuera de orden.',
  })
  @ApiNotFoundResponse({ description: 'El mensaje no existe en el canal de la credencial.' })
  @ApiUnauthorizedResponse({ description: 'Credencial de integración ausente o inválida.' })
  async status(
    @CurrentIntegration() integration: IntegrationContext,
    @Body() body: DeliveryStatusRequestDto,
  ): Promise<DeliveryStatusResponse> {
    const result = await this.updateDeliveryStatus.execute(integration, {
      ...body,
      occurredAt: new Date(body.occurredAt),
    });
    if (result.kind === 'not-found') throw new NotFoundException('Mensaje no encontrado');
    return { applied: result.applied, status: result.status };
  }
}
