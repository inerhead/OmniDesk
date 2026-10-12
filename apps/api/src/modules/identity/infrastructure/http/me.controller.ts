import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { MeResponse } from '@omnidesk/contracts';
import type { SessionContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { CurrentSession } from '../../../../shared/infrastructure/http/request-context.decorators';
import { GetMeUseCase } from '../../application/get-me.use-case';
import { SetActiveTenantUseCase } from '../../application/set-active-tenant.use-case';
import { MeResponseDto, SetActiveTenantRequestDto, toMeResponse } from './identity.dto';
import { UserSessionGuard } from './session.guard';

@ApiTags('me')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@UseGuards(OriginGuard, UserSessionGuard)
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(
    private readonly getMe: GetMeUseCase,
    private readonly setActiveTenant: SetActiveTenantUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: MeResponseDto.Output })
  async me(@CurrentSession() session: SessionContext): Promise<MeResponse> {
    return this.load(session);
  }

  @Post('active-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MeResponseDto.Output })
  @ApiForbiddenResponse({ description: 'El usuario no es miembro activo de esa empresa.' })
  async changeActiveTenant(
    @CurrentSession() session: SessionContext,
    @Body() body: SetActiveTenantRequestDto,
  ): Promise<MeResponse> {
    const result = await this.setActiveTenant.execute(session, body.tenantId);
    if (result === 'not-member') throw new ForbiddenException('No eres miembro de esa empresa');
    return this.load({ ...session, activeTenantId: body.tenantId });
  }

  private async load(session: SessionContext): Promise<MeResponse> {
    const me = await this.getMe.execute(session);
    if (!me) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
    }
    return toMeResponse(me);
  }
}
