import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { MemberRepository } from '../application/ports/member.repository';
import type { Member, NewMember } from '../domain/member';

const select = {
  id: true,
  tenantId: true,
  displayName: true,
  email: true,
  role: true,
} as const;

@Injectable()
export class PrismaMemberRepository implements MemberRepository {
  constructor(private readonly db: PrismaDb) {}

  upsertByEmail(tenantId: string, data: NewMember): Promise<Member> {
    return this.db.client.tenantMember.upsert({
      where: { tenantId_email: { tenantId, email: data.email } },
      create: { tenantId, ...data },
      update: { displayName: data.displayName, role: data.role },
      select,
    });
  }

  findById(tenantId: string, id: string): Promise<Member | null> {
    return this.db.client.tenantMember.findFirst({ where: { id, tenantId }, select });
  }

  list(tenantId: string): Promise<Member[]> {
    return this.db.client.tenantMember.findMany({
      where: { tenantId },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      select,
    });
  }
}
