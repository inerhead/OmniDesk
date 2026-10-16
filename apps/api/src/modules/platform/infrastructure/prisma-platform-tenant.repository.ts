import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import { tenantState, tenantStateSelect } from '../../tenancy/domain/tenant-state';
import type { PlatformTenantRepository } from '../application/ports/platform-tenant.repository';
import type { PlatformTenant } from '../domain/platform-tenant';

const select = {
  id: true,
  name: true,
  slug: true,
  contactPhone: true,
  contactEmail: true,
  createdAt: true,
  approvedAt: true,
  suspensionReason: true,
  ...tenantStateSelect,
  // El Owner más antiguo: en revisión, el único miembro y quien pidió el alta.
  members: {
    where: { role: 'OWNER', removedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { userId: true, displayName: true, email: true },
  },
} as const;

type Row = {
  id: string;
  name: string;
  slug: string;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  suspensionReason: string | null;
  approval: 'PENDING' | 'APPROVED';
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  deletionRequestedAt: Date | null;
  members: Array<{ userId: string | null; displayName: string; email: string }>;
};

const toPlatformTenant = (row: Row): PlatformTenant => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  approval: row.approval,
  state: tenantState(row),
  requester: row.members[0] ?? null,
  contactPhone: row.contactPhone,
  contactEmail: row.contactEmail,
  requestedAt: row.createdAt,
  approvedAt: row.approvedAt,
  suspendedAt: row.suspendedAt,
  suspensionReason: row.suspensionReason,
});

@Injectable()
export class PrismaPlatformTenantRepository implements PlatformTenantRepository {
  constructor(private readonly db: PrismaDb) {}

  async listPending(): Promise<PlatformTenant[]> {
    const rows = await this.db.client.tenant.findMany({
      where: { approval: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select,
    });
    return rows.map(toPlatformTenant);
  }

  async listApproved(): Promise<PlatformTenant[]> {
    const rows = await this.db.client.tenant.findMany({
      // Las que están en borrado salen de Aprobadas (SPEC 20): están en Borradas.
      where: { approval: 'APPROVED', deletionRequestedAt: null },
      orderBy: [{ approvedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select,
    });
    return rows.map(toPlatformTenant);
  }

  async findForUpdate(tenantId: string): Promise<PlatformTenant | null> {
    await this.db.client
      .$queryRaw`SELECT 1 FROM "tenants" WHERE "id" = ${tenantId}::uuid FOR UPDATE`;
    const row = await this.db.client.tenant.findUnique({ where: { id: tenantId }, select });
    return row && toPlatformTenant(row);
  }

  async approve(tenantId: string, byUserId: string, at: Date): Promise<void> {
    await this.db.client.tenant.update({
      where: { id: tenantId },
      data: { approval: 'APPROVED', approvedAt: at, approvedByUserId: byUserId },
    });
  }

  async deletePending(tenantId: string): Promise<void> {
    await this.db.client.tenantMember.deleteMany({ where: { tenantId } });
    await this.db.client.tenant.delete({ where: { id: tenantId, approval: 'PENDING' } });
  }

  async suspend(
    tenantId: string,
    data: { byUserId: string; reason: string; at: Date },
  ): Promise<boolean> {
    const { count } = await this.db.client.tenant.updateMany({
      where: { id: tenantId, approval: 'APPROVED', suspendedAt: null },
      data: {
        suspendedAt: data.at,
        suspendedByUserId: data.byUserId,
        suspensionReason: data.reason,
      },
    });
    return count === 1;
  }

  async unsuspend(tenantId: string): Promise<boolean> {
    const { count } = await this.db.client.tenant.updateMany({
      where: { id: tenantId, suspendedAt: { not: null } },
      data: { suspendedAt: null, suspendedByUserId: null, suspensionReason: null },
    });
    return count === 1;
  }

  async releaseSessions(tenantId: string): Promise<number> {
    const { count } = await this.db.client.session.updateMany({
      where: { activeTenantId: tenantId, revokedAt: null },
      data: { activeTenantId: null },
    });
    return count;
  }
}
