import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import type { TransactionRunner } from '../../application/transaction-runner.port';
import { PrismaService } from './prisma.service';
import { TenantPrisma } from './tenant-prisma';
import { currentTenantId } from './tenant-scope';

const activeTransaction = new AsyncLocalStorage<Prisma.TransactionClient>();

/**
 * Cliente que deben usar los repositorios: la transacción activa; si no hay, el del rol de
 * aplicación cuando se atiende a una empresa (SPEC 12) o el dueño en un camino de sistema.
 */
@Injectable()
export class PrismaDb {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrisma,
  ) {}

  get client(): Prisma.TransactionClient {
    const transaction = activeTransaction.getStore();
    if (transaction) return transaction;
    return currentTenantId() ? this.tenantPrisma.scopedClient : this.prisma;
  }
}

@Injectable()
export class PrismaTransactionRunner implements TransactionRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrisma,
  ) {}

  run<T>(work: () => Promise<T>, options?: { timeoutMs: number }): Promise<T> {
    if (activeTransaction.getStore()) return work();
    const tenantId = currentTenantId();
    if (tenantId) {
      return this.tenantPrisma.transaction(
        tenantId,
        (tx) => activeTransaction.run(tx, work),
        options,
      );
    }
    return this.prisma.$transaction(
      (tx) => activeTransaction.run(tx, work),
      options ? { timeout: options.timeoutMs } : undefined,
    );
  }

  runDetached<T>(work: () => Promise<T>): Promise<T> {
    return activeTransaction.exit(work);
  }
}
