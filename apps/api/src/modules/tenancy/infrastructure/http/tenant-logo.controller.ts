import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { SessionContext } from '../../../../shared/application/request-context';
import { IMAGE_RESPONSE_HEADERS } from '../../../../shared/infrastructure/http/image-upload';
import { CurrentSession } from '../../../../shared/infrastructure/http/request-context.decorators';
import { UserSessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { GetTenantLogoUseCase, type LogoContent } from '../../application/tenant-logo.use-cases';

/** Envía un logo con las cabeceras de imagen del API, o 404. */
export function sendLogo(res: Response, logo: LogoContent | null): void {
  if (!logo) throw new NotFoundException('Logo no encontrado');
  res
    .status(HttpStatus.OK)
    .set({
      'Content-Type': logo.mimeType,
      'Content-Length': String(logo.bytes.length),
      ...IMAGE_RESPONSE_HEADERS,
    })
    .end(logo.bytes);
}

/**
 * Logo por id: con sesión, sin exigir que sea la empresa activa (el selector muestra el de todas las
 * empresas del usuario).
 */
@ApiTags('tenants')
@UseGuards(UserSessionGuard)
@Controller({ path: 'tenants', version: '1' })
export class TenantLogoController {
  constructor(private readonly getLogo: GetTenantLogoUseCase) {}

  @Get(':id/logo')
  @ApiOkResponse({ description: 'El logo (JPEG o WebP).' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
  @ApiNotFoundResponse({ description: 'Sin logo o no eres miembro (o no OWNER si está inactiva).' })
  async logo(
    @CurrentSession() session: SessionContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    sendLogo(res, await this.getLogo.execute(session, id));
  }
}
