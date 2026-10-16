import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import { JOB_LOCK } from '../retention/application/ports/job-lock';
import { PgJobLock } from '../retention/infrastructure/pg-job-lock';
import { PLATFORM_TENANT_REPOSITORY } from './application/ports/platform-tenant.repository';
import { TENANT_DELETION_REPOSITORY } from './application/ports/tenant-deletion.repository';
import { TENANT_PURGE_STORE } from './application/ports/tenant-purge.store';
import { TENANT_PURGE_TRIGGER } from './application/ports/tenant-purge-trigger';
import { TenantPurgeJob } from './application/tenant-purge.job';
import {
  ApproveTenantUseCase,
  ListPlatformTenantsUseCase,
  RejectTenantUseCase,
  SuspendTenantUseCase,
  UnsuspendTenantUseCase,
} from './application/platform.use-cases';
import {
  ListTenantDeletionsUseCase,
  PreviewTenantDeletionUseCase,
  RequestTenantDeletionUseCase,
} from './application/tenant-deletion.use-cases';
import { PlatformAdminGuard } from './infrastructure/http/platform-admin.guard';
import { PlatformController } from './infrastructure/http/platform.controller';
import { PlatformTenantDeletionsController } from './infrastructure/http/platform-tenant-deletions.controller';
import { PrismaPlatformTenantRepository } from './infrastructure/prisma-platform-tenant.repository';
import { PrismaTenantDeletionRepository } from './infrastructure/prisma-tenant-deletion.repository';
import { PrismaTenantPurgeStore } from './infrastructure/prisma-tenant-purge.store';
import { TenantPurgeScheduler } from './infrastructure/tenant-purge-scheduler';

/** Admin de plataforma (SPEC 18 y 20): aprobar, rechazar, suspender y borrar empresas. */
@Module({
  imports: [IdentityModule, ConversationsModule, AttachmentsModule],
  controllers: [PlatformController, PlatformTenantDeletionsController],
  providers: [
    { provide: PLATFORM_TENANT_REPOSITORY, useClass: PrismaPlatformTenantRepository },
    PlatformAdminGuard,
    ListPlatformTenantsUseCase,
    ApproveTenantUseCase,
    RejectTenantUseCase,
    SuspendTenantUseCase,
    UnsuspendTenantUseCase,
    { provide: TENANT_DELETION_REPOSITORY, useClass: PrismaTenantDeletionRepository },
    RequestTenantDeletionUseCase,
    PreviewTenantDeletionUseCase,
    ListTenantDeletionsUseCase,
    { provide: TENANT_PURGE_STORE, useClass: PrismaTenantPurgeStore },
    { provide: JOB_LOCK, useClass: PgJobLock },
    TenantPurgeJob,
    TenantPurgeScheduler,
    { provide: TENANT_PURGE_TRIGGER, useExisting: TenantPurgeScheduler },
  ],
})
export class PlatformModule {}
