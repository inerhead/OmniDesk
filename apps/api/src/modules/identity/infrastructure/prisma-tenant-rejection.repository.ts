import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  OpenTenantRejection,
  TenantRejection,
  TenantRejectionRepository,
} from '../application/ports/tenant-rejection.repository';

@Injectable()
export class PrismaTenantRejectionRepository implements TenantRejectionRepository {
  constructor(private readonly db: PrismaDb) {}

  async create(data: Omit<TenantRejection, 'id'> & { rejectedByUserId: string }): Promise<void> {
    await this.db.client.tenantRejection.create({ data });
  }

  findOpenForUser(userId: string): Promise<OpenTenantRejection | null> {
    return this.db.client.tenantRejection.findFirst({
      where: { userId, dismissedAt: null },
      orderBy: { rejectedAt: 'desc' },
      select: { tenantName: true, reason: true, rejectedAt: true },
    });
  }

  async dismissForUser(userId: string, at: Date): Promise<void> {
    await this.db.client.tenantRejection.updateMany({
      where: { userId, dismissedAt: null },
      data: { dismissedAt: at },
    });
  }

  async listSince(since: Date) {
    const rows = await this.db.client.tenantRejection.findMany({
      where: { rejectedAt: { gte: since } },
      orderBy: { rejectedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        tenantName: true,
        tenantSlug: true,
        reason: true,
        contactPhone: true,
        contactEmail: true,
        requestedAt: true,
        rejectedAt: true,
        user: { select: { displayName: true, email: true } },
      },
    });
    return rows.map(({ user, ...row }) => ({ ...row, requester: user }));
  }

  async deleteRejectedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.db.client.tenantRejection.deleteMany({
      where: { rejectedAt: { lt: cutoff } },
    });
    return count;
  }
}
