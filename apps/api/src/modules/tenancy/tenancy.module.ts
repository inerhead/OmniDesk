import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { RequeueTenantInactiveUseCase } from '../conversations/application/requeue-tenant-inactive.use-case';
import { IdentityModule } from '../identity/identity.module';
import { MembersModule } from '../members/members.module';
import { CreateTenantUseCase } from './application/create-tenant.use-case';
import {
  GetCurrentTenantUseCase,
  UpdateCurrentTenantUseCase,
} from './application/manage-tenant.use-cases';
import {
  GetTenantLogoUseCase,
  RemoveTenantLogoUseCase,
  UploadTenantLogoUseCase,
} from './application/tenant-logo.use-cases';
import {
  DeactivateTenantUseCase,
  ReactivateTenantUseCase,
  TENANT_INACTIVE_REQUEUER,
} from './application/tenant-status.use-cases';
import { TENANT_REPOSITORY } from './application/ports/tenant.repository';
import { CurrentTenantController } from './infrastructure/http/current-tenant.controller';
import { TenantLogoController } from './infrastructure/http/tenant-logo.controller';
import { TenantsController } from './infrastructure/http/tenants.controller';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';

@Module({
  imports: [AttachmentsModule, ConversationsModule, IdentityModule, MembersModule],
  controllers: [TenantsController, CurrentTenantController, TenantLogoController],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    CreateTenantUseCase,
    GetCurrentTenantUseCase,
    UpdateCurrentTenantUseCase,
    UploadTenantLogoUseCase,
    RemoveTenantLogoUseCase,
    GetTenantLogoUseCase,
    DeactivateTenantUseCase,
    ReactivateTenantUseCase,
    { provide: TENANT_INACTIVE_REQUEUER, useExisting: RequeueTenantInactiveUseCase },
  ],
  exports: [TENANT_REPOSITORY],
})
export class TenancyModule {}
