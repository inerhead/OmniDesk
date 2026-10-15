import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { MembershipRepository } from '../application/ports/membership.repository';
import { tenantLogoUrl } from '../../tenancy/domain/tenant';
import type { Membership } from '../domain/user';
import { avatarSourceSelect, memberAvatarUrl } from './member-ref';

const select = {
  id: true,
  tenantId: true,
  role: true,
  userId: true,
  tenant: {
    select: { name: true, slug: true, logoKey: true, logoUpdatedAt: true, deactivatedAt: true },
  },
} as const;

type Row = {
  id: string;
  tenantId: string;
  role: Membership['role'];
  userId: string | null;
  tenant: {
    name: string;
    slug: string;
    logoKey: string | null;
    logoUpdatedAt: Date | null;
    deactivatedAt: Date | null;
  };
};

const toMembership = (row: Row): Membership => ({
  memberId: row.id,
  tenantId: row.tenantId,
  tenantName: row.tenant.name,
  tenantSlug: row.tenant.slug,
  role: row.role,
  tenantLogoUrl: tenantLogoUrl({ id: row.tenantId, ...row.tenant }),
  tenantActive: row.tenant.deactivatedAt === null,
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

  async listLoginMembersOfTenant(tenantSlug: string) {
    const rows = await this.db.client.tenantMember.findMany({
      // Una empresa inactiva (SPEC 16) no ofrece login de desarrollo.
      where: {
        tenant: { slug: tenantSlug, deactivatedAt: null },
        removedAt: null,
        userId: { not: null },
      },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      select: { id: true, displayName: true, role: true, user: { select: avatarSourceSelect } },
    });
    return rows.map(({ id, displayName, role, user }) => ({
      memberId: id,
      displayName,
      role,
      avatarUrl: memberAvatarUrl({ user }),
    }));
  }
}
