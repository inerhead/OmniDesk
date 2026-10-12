import { Injectable } from '@nestjs/common';
import type { OutboxPort } from '../../application/outbox.port';
import { PrismaDb } from './prisma-transaction-runner';

/** Usa `PrismaDb`, así que escribe en la transacción activa del caso de uso. */
@Injectable()
export class PrismaOutbox implements OutboxPort {
  constructor(private readonly db: PrismaDb) {}

  async enqueue(event: Parameters<OutboxPort['enqueue']>[0]): Promise<void> {
    await this.db.client.outboxEvent.create({
      data: { tenantId: event.tenantId, type: event.type, payload: event.payload },
    });
  }
}
