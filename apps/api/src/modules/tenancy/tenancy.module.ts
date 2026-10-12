import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MembersModule } from '../members/members.module';
import { CreateTenantUseCase } from './application/create-tenant.use-case';
import { TENANT_REPOSITORY } from './application/ports/tenant.repository';
import { TenantsController } from './infrastructure/http/tenants.controller';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';

@Module({
  imports: [IdentityModule, MembersModule],
  controllers: [TenantsController],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    CreateTenantUseCase,
  ],
  exports: [TENANT_REPOSITORY],
})
export class TenancyModule {}
