import { Global, Module } from '@nestjs/common';
import { OUTBOX_PORT } from '../../application/outbox.port';
import { TRANSACTION_RUNNER } from '../../application/transaction-runner.port';
import { PrismaOutbox } from './prisma-outbox';
import { PrismaDb, PrismaTransactionRunner } from './prisma-transaction-runner';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaDb,
    { provide: TRANSACTION_RUNNER, useClass: PrismaTransactionRunner },
    { provide: OUTBOX_PORT, useClass: PrismaOutbox },
  ],
  exports: [PrismaService, PrismaDb, TRANSACTION_RUNNER, OUTBOX_PORT],
})
export class PrismaModule {}
