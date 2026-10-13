import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import type { TransactionRunner } from '../../application/transaction-runner.port';
import { PrismaService } from './prisma.service';

const activeTransaction = new AsyncLocalStorage<Prisma.TransactionClient>();

/** Cliente que deben usar los repositorios: la transacción activa o, si no hay, el cliente global. */
@Injectable()
export class PrismaDb {
  constructor(private readonly prisma: PrismaService) {}

  get client(): Prisma.TransactionClient {
    return activeTransaction.getStore() ?? this.prisma;
  }
}

@Injectable()
export class PrismaTransactionRunner implements TransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: () => Promise<T>, options?: { timeoutMs: number }): Promise<T> {
    if (activeTransaction.getStore()) return work();
    return this.prisma.$transaction(
      (tx) => activeTransaction.run(tx, work),
      options ? { timeout: options.timeoutMs } : undefined,
    );
  }

  runDetached<T>(work: () => Promise<T>): Promise<T> {
    return activeTransaction.exit(work);
  }
}
