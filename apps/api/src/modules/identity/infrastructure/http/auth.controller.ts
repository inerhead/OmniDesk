import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthProvidersResponse, MeResponse } from '@omnidesk/contracts';
import type { Request, Response } from 'express';
import { ENV, type Env } from '../../../../shared/config/env';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { DevLoginUseCase } from '../../application/dev-login.use-case';
import { GetMeUseCase } from '../../application/get-me.use-case';
import { RevokeSessionUseCase } from '../../application/revoke-session.use-case';
import {
  AuthProvidersResponseDto,
  DevLoginRequestDto,
  MeResponseDto,
  toMeResponse,
} from './identity.dto';
import { clearSessionCookie, readRequestSessionToken, setSessionCookie } from './session-cookie';

/** Login y logout. El login con Google vive en `GoogleAuthController`. */
@ApiTags('auth')
@UseGuards(OriginGuard)
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly devLogin: DevLoginUseCase,
    private readonly revokeSession: RevokeSessionUseCase,
    private readonly getMe: GetMeUseCase,
  ) {}

  @Get('providers')
  @ApiOkResponse({ type: AuthProvidersResponseDto.Output })
  async providers(): Promise<AuthProvidersResponse> {
    return {
      google: Boolean(this.env.GOOGLE_CLIENT_ID),
      demoMembers: this.env.DEMO_MODE ? await this.devLogin.listMembers() : [],
      demoUsers: this.env.DEMO_MODE ? this.devLogin.listDemoUsers() : [],
    };
  }

  @Post('dev-login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MeResponseDto.Output, description: 'Sesión creada (cookie).' })
  @ApiNotFoundResponse({
    description: 'DEMO_MODE desactivado, o miembro o usuario demo desconocido.',
  })
  @ApiForbiddenResponse({ description: 'Origin no permitido.' })
  async devLoginAs(
    @Body() body: DevLoginRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponse> {
    if (!this.env.DEMO_MODE) throw new NotFoundException();
    const userAgent = request.header('user-agent') ?? null;
    const created = body.demoUser
      ? await this.devLogin.executeDemoUser(body.demoUser, userAgent)
      : await this.devLogin.execute(body.memberId!, userAgent);
    if (!created) throw new NotFoundException('Miembro o usuario demo no encontrado');

    setSessionCookie(response, this.env, created.token);
    const me = await this.getMe.execute({
      sessionId: created.session.id,
      userId: created.session.userId,
      activeTenantId: created.session.activeTenantId,
    });
    return toMeResponse(me!);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Sesión revocada y cookie borrada.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.revokeSession.execute(readRequestSessionToken(request));
    clearSessionCookie(response, this.env);
  }
}
