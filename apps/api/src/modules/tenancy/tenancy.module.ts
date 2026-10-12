import { Module } from '@nestjs/common';
import { TENANT_REPOSITORY } from './application/ports/tenant.repository';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';

@Module({
  providers: [{ provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository }],
  exports: [TENANT_REPOSITORY],
})
export class TenancyModule {}
