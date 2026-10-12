import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { MembershipRepository } from '../application/ports/membership.repository';
import type { Membership } from '../domain/user';

const select = {
  id: true,
  tenantId: true,
  role: true,
  userId: true,
  tenant: { select: { name: true, slug: true } },
} as const;

type Row = {
  id: string;
  tenantId: string;
  role: Membership['role'];
  userId: string | null;
  tenant: { name: string; slug: string };
};

const toMembership = (row: Row): Membership => ({
  memberId: row.id,
  tenantId: row.tenantId,
  tenantName: row.tenant.name,
  tenantSlug: row.tenant.slug,
  role: row.role,
});

@Injectable()
export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: PrismaDb) {}

  async listForUser(userId: string): Promise<Membership[]> {
    const rows = await this.db.client.tenantMember.findMany({
      where: { userId, removedAt: null },
      orderBy: [{ tenant: { name: 'asc' } }, { tenantId: 'asc' }],
      select,
    });
    return rows.map(toMembership);
  }

  async findForUser(userId: string, tenantId: string): Promise<Membership | null> {
    const row = await this.db.client.tenantMember.findFirst({
      where: { userId, tenantId, removedAt: null },
      select,
    });
    return row ? toMembership(row) : null;
  }

  async findByMemberId(memberId: string): Promise<(Membership & { userId: string | null }) | null> {
    const row = await this.db.client.tenantMember.findFirst({
      where: { id: memberId, removedAt: null },
      select,
    });
    return row ? { ...toMembership(row), userId: row.userId } : null;
  }

  async listLoginMembersOfTenant(
    tenantSlug: string,
  ): Promise<Array<{ memberId: string; displayName: string; role: Membership['role'] }>> {
    const rows = await this.db.client.tenantMember.findMany({
      where: { tenant: { slug: tenantSlug }, removedAt: null, userId: { not: null } },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      select: { id: true, displayName: true, role: true },
    });
    return rows.map(({ id, displayName, role }) => ({ memberId: id, displayName, role }));
  }
}
