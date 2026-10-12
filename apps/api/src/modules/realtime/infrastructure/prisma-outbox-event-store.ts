import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { OutboxEventStore, PendingOutboxEvent } from '../application/ports/outbox-event-store';

@Injectable()
export class PrismaOutboxEventStore implements OutboxEventStore {
  constructor(private readonly db: PrismaDb) {}

  lockPending(limit: number, now: Date): Promise<PendingOutboxEvent[]> {
    return this.db.client.$queryRaw<PendingOutboxEvent[]>`
      SELECT id::text AS id, tenant_id::text AS "tenantId", type, payload, attempts
      FROM outbox_events
      WHERE published_at IS NULL AND next_attempt_at <= ${now}::timestamptz
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
  }

  async markPublished(id: string, at: Date): Promise<void> {
    await this.db.client.outboxEvent.update({ where: { id }, data: { publishedAt: at } });
  }

  async scheduleRetry(
    id: string,
    retry: { attempts: number; error: string; at: Date },
  ): Promise<void> {
    await this.db.client.outboxEvent.update({
      where: { id },
      data: { attempts: retry.attempts, lastError: retry.error, nextAttemptAt: retry.at },
    });
  }

  async deletePublishedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.db.client.outboxEvent.deleteMany({
      where: { publishedAt: { lt: cutoff } },
    });
    return count;
  }
}
