import { Injectable } from '@nestjs/common';
import { rethrowUniqueConflict } from '../../../shared/infrastructure/prisma/prisma-errors';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { TenantRepository } from '../application/ports/tenant.repository';
import type { Tenant } from '../domain/tenant';

const select = { id: true, slug: true, name: true } as const;

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: PrismaDb) {}

  findBySlug(slug: string): Promise<Tenant | null> {
    return this.db.client.tenant.findUnique({ where: { slug }, select });
  }

  upsertBySlug(data: { slug: string; name: string }): Promise<Tenant> {
    return this.db.client.tenant.upsert({
      where: { slug: data.slug },
      create: data,
      update: { name: data.name },
      select,
    });
  }

  create(data: { slug: string; name: string }): Promise<Tenant> {
    return this.db.client.tenant.create({ data, select }).catch(rethrowUniqueConflict);
  }
}
