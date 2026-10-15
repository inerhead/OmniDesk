import { Injectable } from '@nestjs/common';
import type { TenantStatusReader } from '../../application/tenant-status.port';
import { tenantState, tenantStateSelect, type TenantState } from '../../kernel/tenant-state';
import { PrismaDb } from './prisma-transaction-runner';

@Injectable()
export class PrismaTenantStatus implements TenantStatusReader {
  constructor(private readonly db: PrismaDb) {}

  async state(tenantId: string): Promise<TenantState | null> {
    const row = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: tenantStateSelect,
    });
    return row && tenantState(row);
  }

  async isActive(tenantId: string): Promise<boolean> {
    return (await this.state(tenantId)) === 'active';
  }
}
