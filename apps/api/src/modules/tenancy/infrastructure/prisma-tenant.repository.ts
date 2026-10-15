import { Injectable } from '@nestjs/common';
import { rethrowUniqueConflict } from '../../../shared/infrastructure/prisma/prisma-errors';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import { memberRefSelect, toMemberRefOrNull } from '../../identity/infrastructure/member-ref';
import type { TenantRepository } from '../application/ports/tenant.repository';
import type { Tenant, TenantDetails } from '../domain/tenant';

const select = { id: true, slug: true, name: true } as const;

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: PrismaDb) {}

  findBySlug(slug: string): Promise<Tenant | null> {
    return this.db.client.tenant.findUnique({ where: { slug }, select });
  }

  upsertBySlug(data: { slug: string; name: string }): Promise<Tenant> {
    return this.db.client.tenant.upsert({
      where: { slug: data.slug },
      create: data,
      update: { name: data.name },
      select,
    });
  }

  create(data: { slug: string; name: string }): Promise<Tenant> {
    return this.db.client.tenant.create({ data, select }).catch(rethrowUniqueConflict);
  }

  async findDetails(tenantId: string): Promise<TenantDetails | null> {
    const row = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        ...select,
        logoKey: true,
        logoUpdatedAt: true,
        deactivatedAt: true,
        deactivatedBy: { select: memberRefSelect },
      },
    });
    return row && { ...row, deactivatedBy: toMemberRefOrNull(row.deactivatedBy) };
  }

  async findLogo(tenantId: string): Promise<{ logoKey: string | null; active: boolean } | null> {
    const row = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { logoKey: true, deactivatedAt: true },
    });
    return row && { logoKey: row.logoKey, active: row.deactivatedAt === null };
  }

  async update(tenantId: string, data: { name?: string; slug?: string }): Promise<void> {
    await this.db.client.tenant
      .update({ where: { id: tenantId }, data, select: { id: true } })
      .catch(rethrowUniqueConflict);
  }

  async replaceLogo(
    tenantId: string,
    next: { key: string; at: Date } | null,
  ): Promise<{ previousKey: string | null }> {
    // Lee la clave vieja y escribe la nueva en una sola sentencia, con la fila bloqueada.
    const rows = await this.db.client.$queryRaw<Array<{ previous_key: string | null }>>`
      UPDATE tenants SET logo_key = ${next?.key ?? null}, logo_updated_at = ${next?.at ?? null}
      FROM (SELECT id, logo_key FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE) AS old
      WHERE tenants.id = old.id
      RETURNING old.logo_key AS previous_key`;
    return { previousKey: rows[0]?.previous_key ?? null };
  }

  async deactivate(tenantId: string, byMemberId: string, at: Date): Promise<boolean> {
    const { count } = await this.db.client.tenant.updateMany({
      where: { id: tenantId, deactivatedAt: null },
      data: { deactivatedAt: at, deactivatedByMemberId: byMemberId },
    });
    return count > 0;
  }

  async revokePendingInvitations(tenantId: string, at: Date): Promise<number> {
    const { count } = await this.db.client.invitation.updateMany({
      where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: at } },
      data: { revokedAt: at },
    });
    return count;
  }

  async reactivate(tenantId: string): Promise<boolean> {
    const { count } = await this.db.client.tenant.updateMany({
      where: { id: tenantId, deactivatedAt: { not: null } },
      data: { deactivatedAt: null, deactivatedByMemberId: null },
    });
    return count > 0;
  }
}
