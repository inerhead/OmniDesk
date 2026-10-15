import { Global, Module } from '@nestjs/common';
import { OUTBOX_PORT } from '../../application/outbox.port';
import { TENANT_STATUS } from '../../application/tenant-status.port';
import { TRANSACTION_RUNNER } from '../../application/transaction-runner.port';
import { PrismaOutbox } from './prisma-outbox';
import { PrismaTenantStatus } from './prisma-tenant-status';
import { PrismaDb, PrismaTransactionRunner } from './prisma-transaction-runner';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaDb,
    { provide: TRANSACTION_RUNNER, useClass: PrismaTransactionRunner },
    { provide: OUTBOX_PORT, useClass: PrismaOutbox },
    { provide: TENANT_STATUS, useClass: PrismaTenantStatus },
  ],
  exports: [PrismaService, PrismaDb, TRANSACTION_RUNNER, OUTBOX_PORT, TENANT_STATUS],
})
export class PrismaModule {}
