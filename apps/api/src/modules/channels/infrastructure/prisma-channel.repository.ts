import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { IntegrationContext } from '../../../shared/application/request-context';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  ChannelForSend,
  ChannelRepository,
  CredentialRotation,
} from '../application/ports/channel.repository';
import type { Channel, ChannelSigningSecrets, ChannelSummary, NewChannel } from '../domain/channel';

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

function summarySelect(now: Date) {
  return {
    ...channelSelect,
    hmacSecretEnc: true,
    aiEnabled: true,
    whatsappAccessTokenEnc: true,
    whatsappAppSecretEnc: true,
    whatsappVerifyTokenHash: true,
    credentialsRotatedAt: true,
    credentials: { where: activeCredentialWhere(now), select: { id: true }, take: 1 },
  } satisfies Prisma.ChannelSelect;
}

type SummaryRow = Prisma.ChannelGetPayload<{ select: ReturnType<typeof summarySelect> }>;

function toSummary({
  hmacSecretEnc,
  credentials,
  whatsappAccessTokenEnc,
  whatsappAppSecretEnc,
  whatsappVerifyTokenHash,
  ...row
}: SummaryRow): ChannelSummary {
  return {
    ...row,
    hasCredentials: credentials.length > 0 && hmacSecretEnc !== null,
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
      where: { keyHash, ...activeCredentialWhere(now) },
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
      select: { id: true, provider: true, externalId: true, webhookUrl: true, hmacSecretEnc: true },
    });
  }

  async listSummaries(tenantId: string, now: Date): Promise<ChannelSummary[]> {
    const rows = await this.db.client.channel.findMany({
      where: { tenantId },
      select: summarySelect(now),
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSummary);
  }

  async findSummary(
    tenantId: string,
    channelId: string,
    now: Date,
  ): Promise<ChannelSummary | null> {
    const row = await this.db.client.channel.findFirst({
      where: { id: channelId, tenantId },
      select: summarySelect(now),
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

  async rotateCredentials(
    tenantId: string,
    channelId: string,
    { keyHash, hmacSecretEnc, now, previousValidUntil }: CredentialRotation,
  ): Promise<{ hadPrevious: boolean }> {
    const channel = await this.db.client.channel.findFirstOrThrow({
      where: { id: channelId, tenantId },
      select: { hmacSecretEnc: true },
    });
    // Las vigentes sin vencimiento pasan a vencer en 24 h; las que ya vencían antes, igual.
    const { count } = await this.db.client.integrationCredential.updateMany({
      where: {
        channelId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: previousValidUntil } }],
      },
      data: { expiresAt: previousValidUntil },
    });
    await this.db.client.integrationCredential.create({ data: { tenantId, channelId, keyHash } });
    await this.db.client.channel.update({
      where: { id: channelId },
      data: {
        hmacSecretEnc,
        hmacSecretPrevEnc: channel.hmacSecretEnc,
        hmacSecretPrevUntil: channel.hmacSecretEnc ? previousValidUntil : null,
        credentialsRotatedAt: now,
      },
    });
    return { hadPrevious: count > 0 || channel.hmacSecretEnc !== null };
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
