import { Injectable } from '@nestjs/common';
import type { TenantStatusReader } from '../../application/tenant-status.port';
import { PrismaDb } from './prisma-transaction-runner';

@Injectable()
export class PrismaTenantStatus implements TenantStatusReader {
  constructor(private readonly db: PrismaDb) {}

  async isActive(tenantId: string): Promise<boolean> {
    const row = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { deactivatedAt: true },
    });
    return row !== null && row.deactivatedAt === null;
  }
}
