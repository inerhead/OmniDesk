import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AVATAR_UPLOAD_MAX_BYTES } from '@omnidesk/contracts';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/application/ports/attachment-storage';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/application/ports/user.repository';
import type { User } from '../../identity/domain/user';
import { avatarStorageKey, detectAvatarMimeType } from '../domain/avatar-image';
import { AVATAR_REPOSITORY, type AvatarRepository } from './ports/avatar.repository';

export type UploadAvatarResult =
  | { kind: 'ok'; user: User }
  | { kind: 'unsupported-type' }
  | { kind: 'too-large' }
  | { kind: 'user-not-found' };

/** Guarda la foto nueva, apunta el usuario a ella y borra la anterior. */
@Injectable()
export class UploadAvatarUseCase {
  private readonly logger = new Logger(UploadAvatarUseCase.name);

  constructor(
    @Inject(AVATAR_REPOSITORY) private readonly avatars: AvatarRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, bytes: Buffer): Promise<UploadAvatarResult> {
    if (bytes.length > AVATAR_UPLOAD_MAX_BYTES) return { kind: 'too-large' };
    const mimeType = detectAvatarMimeType(bytes);
    if (!mimeType) return { kind: 'unsupported-type' };
    if (!(await this.avatars.findOwner(userId))) return { kind: 'user-not-found' };

    const key = avatarStorageKey(userId, randomUUID());
    await this.storage.put(key, bytes, { contentType: mimeType, contentLength: bytes.length });
    let previousKey: string | null;
    try {
      ({ previousKey } = await this.avatars.replace(userId, { key, at: this.clock.now() }));
    } catch (error) {
      await deleteQuietly(this.storage, this.logger, key);
      throw error;
    }
    if (previousKey) await deleteQuietly(this.storage, this.logger, previousKey);
    const user = await this.users.findById(userId);
    return user ? { kind: 'ok', user } : { kind: 'user-not-found' };
  }
}

/** Un fallo al borrar solo deja un huérfano bajo `users/`: no tumba la petición. */
export async function deleteQuietly(
  storage: AttachmentStorage,
  logger: Logger,
  key: string,
): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    logger.warn(`No se pudo borrar la foto ${key}: ${(error as Error).message}`);
  }
}
