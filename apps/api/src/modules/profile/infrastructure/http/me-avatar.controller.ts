import {
  BadRequestException,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
  Put,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type ArgumentsHost,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { AVATAR_UPLOAD_MAX_BYTES, MeResponseSchema, type MeResponse } from '@omnidesk/contracts';
import type { Response } from 'express';
import { memoryStorage, MulterError } from 'multer';
import { createZodDto } from 'nestjs-zod';
import type { SessionContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { CurrentSession } from '../../../../shared/infrastructure/http/request-context.decorators';
import type { User } from '../../../identity/domain/user';
import { UserSessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { RemoveAvatarUseCase } from '../../application/remove-avatar.use-case';
import { UploadAvatarUseCase } from '../../application/upload-avatar.use-case';

class MeUserDto extends createZodDto(MeResponseSchema.shape.user) {}

/** Multer responde 500 al superar el límite; el contrato de este endpoint es 413. */
@Catch(MulterError)
class AvatarUploadExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error.code === 'LIMIT_FILE_SIZE') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({ message: 'La foto supera 1 MB' });
      return;
    }
    response.status(HttpStatus.BAD_REQUEST).json({ message: error.message });
  }
}

const unauthenticated = () =>
  apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Inicia sesión para continuar');

function toUserDto(user: User): MeResponse['user'] {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

@ApiTags('me')
@ApiUnauthorizedResponse({ description: 'Sin sesión (`UNAUTHENTICATED`).' })
@UseGuards(OriginGuard, UserSessionGuard)
@Controller({ path: 'me/avatar', version: '1' })
export class MeAvatarController {
  constructor(
    private readonly uploadAvatar: UploadAvatarUseCase,
    private readonly removeAvatar: RemoveAvatarUseCase,
  ) {}

  /** El recorte ya reducido en la web (512×512, WebP o JPEG). */
  @Put()
  @UseFilters(AvatarUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      // Sin esto multer escribe a disco y `file.buffer` llega vacío.
      storage: memoryStorage(),
      limits: { fileSize: AVATAR_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({ type: MeUserDto.Output, description: 'Usuario con la foto nueva.' })
  @ApiBadRequestResponse({ description: 'Falta el archivo.' })
  @ApiPayloadTooLargeResponse({ description: 'Más de 1 MB.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'No es JPEG ni WebP por sus bytes.' })
  async upload(
    @CurrentSession() session: SessionContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<MeResponse['user']> {
    if (!file) throw new BadRequestException('Falta el archivo');
    const result = await this.uploadAvatar.execute(session.userId, file.buffer);
    switch (result.kind) {
      case 'unsupported-type':
        throw new UnsupportedMediaTypeException('La foto debe ser JPEG o WebP');
      case 'too-large':
        throw new PayloadTooLargeException('La foto supera 1 MB');
      case 'user-not-found':
        throw unauthenticated();
      case 'ok':
        return toUserDto(result.user);
    }
  }

  @Delete()
  @ApiOkResponse({
    type: MeUserDto.Output,
    description: 'Usuario sin foto subida: vuelve a la de Google o a `null`.',
  })
  async remove(@CurrentSession() session: SessionContext): Promise<MeResponse['user']> {
    const user = await this.removeAvatar.execute(session.userId);
    if (!user) throw unauthenticated();
    return toUserDto(user);
  }
}
