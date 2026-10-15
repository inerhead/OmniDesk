import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { SessionContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { IMAGE_RESPONSE_HEADERS } from '../../../../shared/infrastructure/http/image-upload';
import { ResolveSessionUseCase } from '../../../identity/application/resolve-session.use-case';
import { readRequestSessionToken } from '../../../identity/infrastructure/http/session-cookie';
import { GetAvatarUseCase } from '../../application/get-avatar.use-case';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class UserAvatarController {
  constructor(
    private readonly getAvatar: GetAvatarUseCase,
    private readonly resolveSession: ResolveSessionUseCase,
  ) {}

  /**
   * Sin guard de sesión: la excepción `DEMO_MODE` la sirve sin cookie. `?v=` cambia con cada subida,
   * así que la respuesta se cachea un año.
   */
  @Get(':id/avatar')
  @ApiOkResponse({ description: 'La foto (JPEG o WebP).' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión, salvo un usuario demo con `DEMO_MODE`.' })
  @ApiNotFoundResponse({ description: 'Sin foto subida o no compartes la empresa activa.' })
  async avatar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.getAvatar.execute(await this.viewer(req), id);
    if (result.kind === 'unauthenticated') {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
    }
    if (result.kind === 'not-found') throw new NotFoundException('Foto no encontrada');
    res
      .status(HttpStatus.OK)
      .set({
        'Content-Type': result.mimeType,
        'Content-Length': String(result.bytes.length),
        ...IMAGE_RESPONSE_HEADERS,
      })
      .end(result.bytes);
  }

  /** Sesión opcional: no renueva la cookie, eso lo hacen las rutas con guard. */
  private async viewer(req: Request): Promise<SessionContext | null> {
    const resolved = await this.resolveSession.execute(readRequestSessionToken(req));
    if (!resolved) return null;
    const { id, userId, activeTenantId } = resolved.session;
    return { sessionId: id, userId, activeTenantId };
  }
}
