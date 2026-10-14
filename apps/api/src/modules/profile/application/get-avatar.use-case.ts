import { buffer } from 'node:stream/consumers';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../shared/config/env';
import type { SessionContext } from '../../../shared/application/request-context';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/application/ports/attachment-storage';
import { detectAvatarMimeType, type AvatarMimeType } from '../domain/avatar-image';
import { AVATAR_REPOSITORY, type AvatarRepository } from './ports/avatar.repository';

export type GetAvatarResult =
  | { kind: 'ok'; bytes: Buffer; mimeType: AvatarMimeType }
  | { kind: 'unauthenticated' }
  | { kind: 'not-found' };

/**
 * Foto subida de un usuario. Con sesión: la propia, o la de alguien que es o fue miembro de la
 * empresa activa. Sin sesión: solo con `DEMO_MODE` y solo usuarios demo (selector del login).
 */
@Injectable()
export class GetAvatarUseCase {
  constructor(
    @Inject(AVATAR_REPOSITORY) private readonly avatars: AvatarRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async execute(viewer: SessionContext | null, targetUserId: string): Promise<GetAvatarResult> {
    const owner = await this.avatars.findOwner(targetUserId);
    const isDemoUser = owner !== null && owner.googleSub === null;
    if (!viewer && !(this.env.DEMO_MODE && isDemoUser)) return { kind: 'unauthenticated' };
    if (!owner?.avatarKey) return { kind: 'not-found' };
    if (viewer && viewer.userId !== targetUserId) {
      const allowed =
        viewer.activeTenantId !== null &&
        (await this.avatars.sharesTenant(viewer.userId, targetUserId, viewer.activeTenantId));
      if (!allowed) return { kind: 'not-found' };
    }

    // Una foto pesa ≤ 1 MB: se lee entera para fijar Content-Length y el tipo por sus bytes.
    const bytes = await buffer((await this.storage.get(owner.avatarKey)).body);
    const mimeType = detectAvatarMimeType(bytes);
    return mimeType ? { kind: 'ok', bytes, mimeType } : { kind: 'not-found' };
  }
}
