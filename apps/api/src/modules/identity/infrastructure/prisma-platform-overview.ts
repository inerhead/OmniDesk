import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { PlatformOverview } from '../application/ports/platform-overview.port';

/** Cruza empresas: `/me` no tiene empresa fijada, así que va con el rol dueño (SPEC 12). */
@Injectable()
export class PrismaPlatformOverview implements PlatformOverview {
  constructor(private readonly db: PrismaDb) {}

  countPendingTenants(): Promise<number> {
    return this.db.client.tenant.count({ where: { approval: 'PENDING' } });
  }
}
