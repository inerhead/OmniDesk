import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import { avatarSourceSelect, memberAvatarUrl } from '../../identity/infrastructure/member-ref';
import type { MemberRepository } from '../application/ports/member.repository';
import type { Member, MemberRole, NewMember } from '../domain/member';

const select = {
  id: true,
  tenantId: true,
  displayName: true,
  email: true,
  role: true,
  user: { select: avatarSourceSelect },
} satisfies Prisma.TenantMemberSelect;

type MemberRow = Prisma.TenantMemberGetPayload<{ select: typeof select }>;

function toMember({ user, ...row }: MemberRow): Member {
  return { ...row, avatarUrl: memberAvatarUrl({ user }) };
}

function toMemberOrNull(row: MemberRow | null): Member | null {
  return row && toMember(row);
}

@Injectable()
export class PrismaMemberRepository implements MemberRepository {
  constructor(private readonly db: PrismaDb) {}

  async upsertByEmail(tenantId: string, data: NewMember): Promise<Member> {
    const row = await this.db.client.tenantMember.upsert({
      where: { tenantId_email: { tenantId, email: data.email } },
      create: { tenantId, ...data },
      update: {
        displayName: data.displayName,
        role: data.role,
        ...(data.userId && { userId: data.userId }),
      },
      select,
    });
    return toMember(row);
  }

  async findById(tenantId: string, id: string): Promise<Member | null> {
    return toMemberOrNull(
      await this.db.client.tenantMember.findFirst({
        where: { id, tenantId, removedAt: null },
        select,
      }),
    );
  }

  async list(tenantId: string): Promise<Member[]> {
    const rows = await this.db.client.tenantMember.findMany({
      where: { tenantId, removedAt: null },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      select,
    });
    return rows.map(toMember);
  }

  async findActiveByEmail(tenantId: string, email: string): Promise<Member | null> {
    return toMemberOrNull(
      await this.db.client.tenantMember.findFirst({
        where: { tenantId, email: email.toLowerCase(), removedAt: null },
        select,
      }),
    );
  }

  async admit(tenantId: string, data: Required<NewMember>): Promise<Member> {
    const email = data.email.toLowerCase();
    const row = await this.db.client.tenantMember.upsert({
      where: { tenantId_email: { tenantId, email } },
      create: { tenantId, ...data, email },
      update: {
        displayName: data.displayName,
        role: data.role,
        userId: data.userId,
        removedAt: null,
      },
      select,
    });
    return toMember(row);
  }

  async lockOwners(tenantId: string): Promise<string[]> {
    const rows = await this.db.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tenant_members
      WHERE tenant_id = ${tenantId}::uuid AND role = 'OWNER' AND removed_at IS NULL
      FOR UPDATE`;
    return rows.map((row) => row.id);
  }

  async updateRole(tenantId: string, id: string, role: MemberRole): Promise<Member> {
    return toMember(
      await this.db.client.tenantMember.update({
        where: { id, tenantId, removedAt: null },
        data: { role },
        select,
      }),
    );
  }

  markRemoved(tenantId: string, id: string, at: Date): Promise<{ userId: string | null }> {
    return this.db.client.tenantMember.update({
      where: { id, tenantId, removedAt: null },
      data: { removedAt: at },
      select: { userId: true },
    });
  }
}
