import { Injectable } from '@nestjs/common';
import type { IntegrationContext } from '../../../shared/application/request-context';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { ChannelRepository } from '../application/ports/channel.repository';
import type { Channel, NewChannel } from '../domain/channel';

@Injectable()
export class PrismaChannelRepository implements ChannelRepository {
  constructor(private readonly db: PrismaDb) {}

  async findActiveCredential(keyHash: string): Promise<IntegrationContext | null> {
    const credential = await this.db.client.integrationCredential.findFirst({
      where: { keyHash, revokedAt: null },
      select: { tenantId: true, channelId: true },
    });
    return credential;
  }

  upsertChannel(tenantId: string, channel: NewChannel): Promise<Channel> {
    return this.db.client.channel.upsert({
      where: { tenantId_externalId: { tenantId, externalId: channel.externalId } },
      create: { tenantId, ...channel },
      update: { name: channel.name, provider: channel.provider },
    });
  }

  async setOnlyActiveCredential(
    tenantId: string,
    channelId: string,
    keyHash: string,
  ): Promise<void> {
    await this.db.client.integrationCredential.upsert({
      where: { keyHash },
      create: { tenantId, channelId, keyHash },
      update: { revokedAt: null },
    });
    await this.db.client.integrationCredential.updateMany({
      where: { channelId, revokedAt: null, keyHash: { not: keyHash } },
      data: { revokedAt: new Date() },
    });
  }
}
