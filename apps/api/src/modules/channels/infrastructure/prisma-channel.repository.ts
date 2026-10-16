import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { IntegrationContext } from '../../../shared/application/request-context';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { ChannelForSend, ChannelRepository } from '../application/ports/channel.repository';
import type {
  Channel,
  ChannelSigningSecrets,
  ChannelSummary,
  NewChannel,
  SecretBlob,
} from '../domain/channel';

const channelSelect = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  provider: true,
  externalId: true,
  phoneNumber: true,
  webhookUrl: true,
} satisfies Prisma.ChannelSelect;

/** Credencial vigente: sin revocar y sin vencer. */
function activeCredentialWhere(now: Date): Prisma.IntegrationCredentialWhereInput {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

const summarySelect = {
  ...channelSelect,
  aiEnabled: true,
  whatsappAccessTokenEnc: true,
  whatsappAppSecretEnc: true,
  whatsappVerifyTokenHash: true,
  credentialsRotatedAt: true,
  n8nClientSecretEnc: true,
} satisfies Prisma.ChannelSelect;

type SummaryRow = Prisma.ChannelGetPayload<{ select: typeof summarySelect }>;

function toSummary({
  whatsappAccessTokenEnc,
  whatsappAppSecretEnc,
  whatsappVerifyTokenHash,
  n8nClientSecretEnc,
  ...row
}: SummaryRow): ChannelSummary {
  return {
    ...row,
    hasN8nClientSecret: n8nClientSecretEnc !== null,
    hasWhatsAppCredentials: !!(
      whatsappAccessTokenEnc &&
      whatsappAppSecretEnc &&
      whatsappVerifyTokenHash
    ),
  };
}

@Injectable()
export class PrismaChannelRepository implements ChannelRepository {
  constructor(private readonly db: PrismaDb) {}

  async findActiveCredential(keyHash: string, now: Date): Promise<IntegrationContext | null> {
    return this.db.client.integrationCredential.findFirst({
      // Con la empresa en borrado (SPEC 20), sus canales cuentan como desconocidos.
      where: { keyHash, ...activeCredentialWhere(now), tenant: { deletionRequestedAt: null } },
      select: { tenantId: true, channelId: true },
    });
  }

  findSigningSecrets(channelId: string): Promise<ChannelSigningSecrets | null> {
    return this.db.client.channel
      .findUnique({
        where: { id: channelId },
        select: { hmacSecretEnc: true, hmacSecretPrevEnc: true, hmacSecretPrevUntil: true },
      })
      .then((row) =>
        row
          ? {
              current: row.hmacSecretEnc,
              previous: row.hmacSecretPrevEnc,
              previousUntil: row.hmacSecretPrevUntil,
            }
          : null,
      );
  }

  findForSend(tenantId: string, channelId: string): Promise<ChannelForSend | null> {
    return this.db.client.channel.findFirst({
      where: { id: channelId, tenantId },
      select: {
        id: true,
        provider: true,
        externalId: true,
        webhookUrl: true,
        n8nClientSecretEnc: true,
      },
    });
  }

  async listSummaries(tenantId: string): Promise<ChannelSummary[]> {
    const rows = await this.db.client.channel.findMany({
      where: { tenantId },
      select: summarySelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSummary);
  }

  async findSummary(tenantId: string, channelId: string): Promise<ChannelSummary | null> {
    const row = await this.db.client.channel.findFirst({
      where: { id: channelId, tenantId },
      select: summarySelect,
    });
    return row ? toSummary(row) : null;
  }

  async create(tenantId: string, channel: NewChannel): Promise<Channel | null> {
    try {
      return await this.db.client.channel.create({
        data: { tenantId, ...channel },
        select: channelSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    channelId: string,
    patch: { name?: string; webhookUrl?: string | null },
  ): Promise<Channel | null> {
    const { count } = await this.db.client.channel.updateMany({
      where: { id: channelId, tenantId },
      data: { ...patch, ...(patch.webhookUrl === null && { aiEnabled: false }) },
    });
    if (count === 0) return null;
    return this.db.client.channel.findUnique({ where: { id: channelId }, select: channelSelect });
  }

  async setN8nClientSecret(
    tenantId: string,
    channelId: string,
    secretEnc: SecretBlob,
  ): Promise<boolean> {
    const { count } = await this.db.client.channel.updateMany({
      where: { id: channelId, tenantId },
      data: { n8nClientSecretEnc: secretEnc },
    });
    return count > 0;
  }

  async clearN8nClientSecret(tenantId: string, channelId: string): Promise<boolean> {
    const { count } = await this.db.client.channel.updateMany({
      where: { id: channelId, tenantId },
      data: { n8nClientSecretEnc: null, aiEnabled: false },
    });
    return count > 0;
  }

  upsertChannel(tenantId: string, channel: NewChannel): Promise<Channel> {
    return this.db.client.channel.upsert({
      where: { tenantId_externalId: { tenantId, externalId: channel.externalId } },
      create: { tenantId, ...channel },
      update: { name: channel.name, provider: channel.provider },
      select: channelSelect,
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
      update: { revokedAt: null, expiresAt: null },
    });
    await this.db.client.integrationCredential.updateMany({
      where: { channelId, revokedAt: null, keyHash: { not: keyHash } },
      data: { revokedAt: new Date() },
    });
  }
}
