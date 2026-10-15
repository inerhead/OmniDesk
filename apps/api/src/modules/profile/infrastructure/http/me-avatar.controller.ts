import {
  BadRequestException,
  Controller,
  Delete,
  HttpStatus,
  PayloadTooLargeException,
  Put,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { MeResponseSchema, type MeResponse } from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import type { SessionContext } from '../../../../shared/application/request-context';
import { apiError } from '../../../../shared/infrastructure/http/api-error';
import {
  ImageUploadExceptionFilter,
  ImageUploadInterceptor,
} from '../../../../shared/infrastructure/http/image-upload';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { CurrentSession } from '../../../../shared/infrastructure/http/request-context.decorators';
import type { User } from '../../../identity/domain/user';
import { UserSessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { RemoveAvatarUseCase } from '../../application/remove-avatar.use-case';
import { UploadAvatarUseCase } from '../../application/upload-avatar.use-case';

class MeUserDto extends createZodDto(MeResponseSchema.shape.user) {}

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
  @UseFilters(ImageUploadExceptionFilter)
  @UseInterceptors(ImageUploadInterceptor)
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
