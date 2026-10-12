import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { EventInbox } from '../application/ports/event-inbox';

@Injectable()
export class PrismaEventInbox implements EventInbox {
  constructor(private readonly db: PrismaDb) {}

  async recordIfNew(channelId: string, externalId: string): Promise<boolean> {
    const { count } = await this.db.client.eventInbox.createMany({
      data: [{ channelId, externalId }],
      skipDuplicates: true,
    });
    return count === 1;
  }
}
