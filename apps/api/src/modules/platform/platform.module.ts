import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import { PLATFORM_TENANT_REPOSITORY } from './application/ports/platform-tenant.repository';
import {
  ApproveTenantUseCase,
  ListPlatformTenantsUseCase,
  RejectTenantUseCase,
  SuspendTenantUseCase,
  UnsuspendTenantUseCase,
} from './application/platform.use-cases';
import { PlatformAdminGuard } from './infrastructure/http/platform-admin.guard';
import { PlatformController } from './infrastructure/http/platform.controller';
import { PrismaPlatformTenantRepository } from './infrastructure/prisma-platform-tenant.repository';

/** Admin de plataforma (SPEC 18): aprobar, rechazar y suspender empresas. */
@Module({
  imports: [IdentityModule, ConversationsModule],
  controllers: [PlatformController],
  providers: [
    { provide: PLATFORM_TENANT_REPOSITORY, useClass: PrismaPlatformTenantRepository },
    PlatformAdminGuard,
    ListPlatformTenantsUseCase,
    ApproveTenantUseCase,
    RejectTenantUseCase,
    SuspendTenantUseCase,
    UnsuspendTenantUseCase,
  ],
})
export class PlatformModule {}
