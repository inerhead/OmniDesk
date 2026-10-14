import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/application/ports/attachment-storage';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/application/ports/user.repository';
import type { User } from '../../identity/domain/user';
import { AVATAR_REPOSITORY, type AvatarRepository } from './ports/avatar.repository';
import { deleteQuietly } from './upload-avatar.use-case';

/** Quita la foto subida: el usuario vuelve a la de Google o a las iniciales. */
@Injectable()
export class RemoveAvatarUseCase {
  private readonly logger = new Logger(RemoveAvatarUseCase.name);

  constructor(
    @Inject(AVATAR_REPOSITORY) private readonly avatars: AvatarRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async execute(userId: string): Promise<User | null> {
    if (!(await this.avatars.findOwner(userId))) return null;
    const { previousKey } = await this.avatars.replace(userId, null);
    if (previousKey) await deleteQuietly(this.storage, this.logger, previousKey);
    return this.users.findById(userId);
  }
}
