import { randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IMAGE_UPLOAD_MAX_BYTES } from '@omnidesk/contracts';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import type { ActorContext, SessionContext } from '../../../shared/application/request-context';
import { detectImageMimeType, type ImageMimeType } from '../../../shared/kernel/image-type';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/application/ports/attachment-storage';
import {
  MEMBERSHIP_REPOSITORY,
  type MembershipRepository,
} from '../../identity/application/ports/membership.repository';
import { tenantLogoStorageKey } from '../domain/tenant-logo';
import { canManageTenant } from '../domain/tenant-policy';
import type { TenantDetailsResult } from './manage-tenant.use-cases';
import { TENANT_REPOSITORY, type TenantRepository } from './ports/tenant.repository';

export type UploadTenantLogoResult =
  TenantDetailsResult | { kind: 'unsupported-type' } | { kind: 'too-large' };

/** Un fallo al borrar solo deja un huérfano bajo `tenants/<id>/`: no tumba la petición. */
async function deleteQuietly(storage: AttachmentStorage, logger: Logger, key: string) {
  try {
    await storage.delete(key);
  } catch (error) {
    logger.warn(`No se pudo borrar el logo ${key}: ${(error as Error).message}`);
  }
}

/** Guarda el logo nuevo de la empresa activa, apunta la empresa a él y borra el anterior. */
@Injectable()
export class UploadTenantLogoUseCase {
  private readonly logger = new Logger(UploadTenantLogoUseCase.name);

  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext, bytes: Buffer): Promise<UploadTenantLogoResult> {
    if (!canManageTenant(actor.role)) return { kind: 'forbidden' };
    if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) return { kind: 'too-large' };
    const mimeType = detectImageMimeType(bytes);
    if (!mimeType) return { kind: 'unsupported-type' };

    const key = tenantLogoStorageKey(actor.tenantId, randomUUID());
    await this.storage.put(key, bytes, { contentType: mimeType, contentLength: bytes.length });
    let previousKey: string | null;
    try {
      ({ previousKey } = await this.tenants.replaceLogo(actor.tenantId, {
        key,
        at: this.clock.now(),
      }));
    } catch (error) {
      await deleteQuietly(this.storage, this.logger, key);
      throw error;
    }
    if (previousKey) await deleteQuietly(this.storage, this.logger, previousKey);
    const tenant = await this.tenants.findDetails(actor.tenantId);
    return tenant ? { kind: 'ok', tenant } : { kind: 'not-found' };
  }
}

/** Quita el logo: la empresa vuelve a sus iniciales. */
@Injectable()
export class RemoveTenantLogoUseCase {
  private readonly logger = new Logger(RemoveTenantLogoUseCase.name);

  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async execute(actor: ActorContext): Promise<TenantDetailsResult> {
    if (!canManageTenant(actor.role)) return { kind: 'forbidden' };
    const { previousKey } = await this.tenants.replaceLogo(actor.tenantId, null);
    if (previousKey) await deleteQuietly(this.storage, this.logger, previousKey);
    const tenant = await this.tenants.findDetails(actor.tenantId);
    return tenant ? { kind: 'ok', tenant } : { kind: 'not-found' };
  }
}

export type LogoContent = { bytes: Buffer; mimeType: ImageMimeType };

/** Lee un logo (≤ 1 MB) entero para fijar Content-Length y el tipo por sus bytes. */
export async function readLogo(
  storage: AttachmentStorage,
  key: string,
): Promise<LogoContent | null> {
  const bytes = await buffer((await storage.get(key)).body);
  const mimeType = detectImageMimeType(bytes);
  return mimeType ? { bytes, mimeType } : null;
}

/**
 * Logo de una empresa: a sus miembros activos si está activa; si está inactiva, solo a sus OWNER
 * (la ven en el selector para reactivarla). `null` = 404.
 */
@Injectable()
export class GetTenantLogoUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async execute(viewer: SessionContext, tenantId: string): Promise<LogoContent | null> {
    const logo = await this.tenants.findLogo(tenantId);
    if (!logo?.logoKey) return null;
    const membership = await this.memberships.findForUser(viewer.userId, tenantId);
    if (!membership) return null;
    if (!logo.active && membership.role !== 'OWNER') return null;
    return readLogo(this.storage, logo.logoKey);
  }
}
