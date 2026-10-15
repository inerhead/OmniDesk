import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { OUTBOX_BACKLOG } from '../../application/outbox-backlog.port';
import { OUTBOX_PORT } from '../../application/outbox.port';
import { TENANT_STATUS } from '../../application/tenant-status.port';
import { TRANSACTION_RUNNER } from '../../application/transaction-runner.port';
import { PrismaOutbox } from './prisma-outbox';
import { PrismaOutboxBacklog } from './prisma-outbox-backlog';
import { PrismaTenantStatus } from './prisma-tenant-status';
import { PrismaDb, PrismaTransactionRunner } from './prisma-transaction-runner';
import { TenantScopeInterceptor } from '../http/tenant-scope.interceptor';
import { AppPrismaService, PrismaService } from './prisma.service';
import { TenantPrisma } from './tenant-prisma';

@Global()
@Module({
  providers: [
    PrismaService,
    AppPrismaService,
    TenantPrisma,
    PrismaDb,
    { provide: TRANSACTION_RUNNER, useClass: PrismaTransactionRunner },
    { provide: OUTBOX_PORT, useClass: PrismaOutbox },
    { provide: OUTBOX_BACKLOG, useClass: PrismaOutboxBacklog },
    { provide: TENANT_STATUS, useClass: PrismaTenantStatus },
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
  ],
  exports: [
    PrismaService,
    TenantPrisma,
    PrismaDb,
    TRANSACTION_RUNNER,
    OUTBOX_PORT,
    OUTBOX_BACKLOG,
    TENANT_STATUS,
  ],
})
export class PrismaModule {}
