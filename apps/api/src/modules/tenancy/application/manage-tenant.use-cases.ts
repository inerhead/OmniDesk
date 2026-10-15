import { Inject, Injectable } from '@nestjs/common';
import { UniqueConflictError } from '../../../shared/application/errors';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import type { ActorContext } from '../../../shared/application/request-context';
import { retentionCutoff, type RetentionDays } from '../domain/retention';
import type { TenantDetails } from '../domain/tenant';
import { canManageTenant, isSlugChangeLocked } from '../domain/tenant-policy';
import { TENANT_REPOSITORY, type TenantRepository } from './ports/tenant.repository';

export type TenantDetailsResult =
  { kind: 'ok'; tenant: TenantDetails } | { kind: 'forbidden' } | { kind: 'not-found' };

/** Datos de la empresa activa para `/settings/company`: solo OWNER (SPEC 16). */
@Injectable()
export class GetCurrentTenantUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  async execute(actor: ActorContext): Promise<TenantDetailsResult> {
    if (!canManageTenant(actor.role)) return { kind: 'forbidden' };
    const tenant = await this.tenants.findDetails(actor.tenantId);
    return tenant ? { kind: 'ok', tenant } : { kind: 'not-found' };
  }
}

export type UpdateTenantResult =
  TenantDetailsResult | { kind: 'slug-taken' } | { kind: 'demo-slug-locked' };

/**
 * Cambia el nombre, el slug y/o la retención (SPEC 12) de la empresa activa. La demo conserva su
 * slug.
 */
@Injectable()
export class UpdateCurrentTenantUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  async execute(
    actor: ActorContext,
    input: { name?: string; slug?: string; retentionDays?: RetentionDays },
  ): Promise<UpdateTenantResult> {
    if (!canManageTenant(actor.role)) return { kind: 'forbidden' };
    const current = await this.tenants.findDetails(actor.tenantId);
    if (!current) return { kind: 'not-found' };
    if (isSlugChangeLocked(current.slug, input.slug)) return { kind: 'demo-slug-locked' };
    if (input.slug !== undefined && input.slug !== current.slug) {
      const owner = await this.tenants.findBySlug(input.slug);
      if (owner && owner.id !== actor.tenantId) return { kind: 'slug-taken' };
    }
    try {
      await this.tenants.update(actor.tenantId, input);
    } catch (error) {
      // Dos cambios simultáneos al mismo slug: el segundo choca con la restricción única.
      if (error instanceof UniqueConflictError) return { kind: 'slug-taken' };
      throw error;
    }
    const tenant = await this.tenants.findDetails(actor.tenantId);
    return tenant ? { kind: 'ok', tenant } : { kind: 'not-found' };
  }
}

export type RetentionPreviewResult = { kind: 'ok'; conversations: number } | { kind: 'forbidden' };

/** Cuántas conversaciones borraría hoy la retención con esos días (SPEC 12): solo OWNER. */
@Injectable()
export class GetRetentionPreviewUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext, days: number): Promise<RetentionPreviewResult> {
    if (!canManageTenant(actor.role)) return { kind: 'forbidden' };
    const cutoff = retentionCutoff(this.clock.now(), days);
    const conversations = await this.tenants.countClosedConversationsBefore(actor.tenantId, cutoff);
    return { kind: 'ok', conversations };
  }
}
