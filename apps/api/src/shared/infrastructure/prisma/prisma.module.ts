import { Global, Module } from '@nestjs/common';
import { TRANSACTION_RUNNER } from '../../application/transaction-runner.port';
import { PrismaDb, PrismaTransactionRunner } from './prisma-transaction-runner';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaDb,
    { provide: TRANSACTION_RUNNER, useClass: PrismaTransactionRunner },
  ],
  exports: [PrismaService, PrismaDb, TRANSACTION_RUNNER],
})
export class PrismaModule {}
