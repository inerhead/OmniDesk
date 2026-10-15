import { Injectable } from '@nestjs/common';
import type { OutboxBacklog } from '../../application/outbox-backlog.port';
import { PrismaService } from './prisma.service';

/**
 * Lee los pendientes con el rol dueño: `outbox_events` tiene RLS y esto mira todas las empresas.
 * Las dos consultas recorren solo el índice parcial `outbox_events_pending`.
 */
@Injectable()
export class PrismaOutboxBacklog implements OutboxBacklog {
  constructor(private readonly prisma: PrismaService) {}

  async pendingByType(): Promise<Array<{ type: string; count: number }>> {
    const rows = await this.prisma.outboxEvent.groupBy({
      by: ['type'],
      where: { publishedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({ type: row.type, count: row._count._all }));
  }

  async oldestPendingCreatedAt(): Promise<Date | null> {
    const { _min } = await this.prisma.outboxEvent.aggregate({
      where: { publishedAt: null },
      _min: { createdAt: true },
    });
    return _min.createdAt;
  }
}
