import { Injectable } from '@nestjs/common';
import { rethrowUniqueConflict } from '../../../shared/infrastructure/prisma/prisma-errors';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import { memberRefSelect, toMemberRefOrNull } from '../../identity/infrastructure/member-ref';
import type { NewTenant, TenantRepository } from '../application/ports/tenant.repository';
import { toRetentionDays, type RetentionDays } from '../domain/retention';
import type { Tenant, TenantDetails } from '../domain/tenant';

const select = { id: true, slug: true, name: true, approval: true } as const;

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: PrismaDb) {}

  findBySlug(slug: string): Promise<Tenant | null> {
    return this.db.client.tenant.findUnique({ where: { slug }, select });
  }

  upsertBySlug(data: { slug: string; name: string }): Promise<Tenant> {
    // La semilla demo nace aprobada: el default de la columna es PENDING (SPEC 18).
    return this.db.client.tenant.upsert({
      where: { slug: data.slug },
      create: { ...data, approval: 'APPROVED' },
      update: { name: data.name },
      select,
    });
  }

  create(data: NewTenant): Promise<Tenant> {
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
        retentionDays: true,
        contactPhone: true,
        contactEmail: true,
      },
    });
    return (
      row && {
        ...row,
        deactivatedBy: toMemberRefOrNull(row.deactivatedBy),
        retentionDays: toRetentionDays(row.retentionDays),
      }
    );
  }

  async findLogo(tenantId: string): Promise<{ logoKey: string | null; active: boolean } | null> {
    const row = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { logoKey: true, deactivatedAt: true },
    });
    return row && { logoKey: row.logoKey, active: row.deactivatedAt === null };
  }

  async update(
    tenantId: string,
    data: { name?: string; slug?: string; retentionDays?: RetentionDays },
  ): Promise<void> {
    await this.db.client.tenant
      .update({ where: { id: tenantId }, data, select: { id: true } })
      .catch(rethrowUniqueConflict);
  }

  countClosedConversationsBefore(tenantId: string, cutoff: Date): Promise<number> {
    return this.db.client.conversation.count({
      where: { tenantId, status: 'CLOSED', lastMessageAt: { lt: cutoff } },
    });
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
