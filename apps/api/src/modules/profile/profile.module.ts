import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { IdentityModule } from '../identity/identity.module';
import { GetAvatarUseCase } from './application/get-avatar.use-case';
import { AVATAR_REPOSITORY } from './application/ports/avatar.repository';
import { RemoveAvatarUseCase } from './application/remove-avatar.use-case';
import { UploadAvatarUseCase } from './application/upload-avatar.use-case';
import { MeAvatarController } from './infrastructure/http/me-avatar.controller';
import { UserAvatarController } from './infrastructure/http/user-avatar.controller';
import { PrismaAvatarRepository } from './infrastructure/prisma-avatar.repository';

/** Foto de perfil del usuario (SPEC 15): se guarda en el bucket de los adjuntos, bajo `users/`. */
@Module({
  imports: [AttachmentsModule, IdentityModule],
  controllers: [MeAvatarController, UserAvatarController],
  providers: [
    UploadAvatarUseCase,
    RemoveAvatarUseCase,
    GetAvatarUseCase,
    { provide: AVATAR_REPOSITORY, useClass: PrismaAvatarRepository },
  ],
})
export class ProfileModule {}
