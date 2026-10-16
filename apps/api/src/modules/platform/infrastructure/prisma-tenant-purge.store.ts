import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  PurgedConversations,
  PurgedRemainder,
  PurgeProgress,
  TenantPurgeStore,
} from '../application/ports/tenant-purge.store';

/** `last_error` guarda un mensaje acotado: un error de Prisma puede traer la consulta entera. */
const MAX_ERROR_LENGTH = 1000;

@Injectable()
export class PrismaTenantPurgeStore implements TenantPurgeStore {
  constructor(private readonly db: PrismaDb) {}

  async tenantsToPurge(): Promise<string[]> {
    const rows = await this.db.client.tenant.findMany({
      where: { deletionRequestedAt: { not: null } },
      orderBy: [{ deletionRequestedAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async lockConversations(tenantId: string, limit: number): Promise<string[]> {
    const rows = await this.db.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM conversations
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((row) => row.id);
  }

  async deleteConversations(
    tenantId: string,
    conversationIds: string[],
  ): Promise<PurgedConversations> {
    const scope = { tenantId, conversationId: { in: conversationIds } };
    const [messages, attachments] = await Promise.all([
      this.db.client.message.count({ where: scope }),
      this.db.client.messageAttachment.count({ where: { tenantId, message: scope } }),
    ]);
    const { count } = await this.db.client.conversation.deleteMany({
      where: { tenantId, id: { in: conversationIds } },
    });
    return { conversations: count, messages, attachments };
  }

  async addProgress(tenantId: string, progress: PurgeProgress): Promise<void> {
    await this.db.client.tenantDeletion.update({
      where: { tenantId },
      data: Object.fromEntries(
        Object.entries(progress).map(([field, value]) => [field, { increment: value }]),
      ),
      select: { id: true },
    });
  }

  async deleteRemainder(
    tenantId: string,
    orphanUserIds: string[],
    at: Date,
  ): Promise<PurgedRemainder> {
    const client = this.db.client;
    const channels = await client.channel.findMany({ where: { tenantId }, select: { id: true } });
    const channelIds = channels.map((channel) => channel.id);

    // Caen sus `contact_identities`. Las conversaciones ya no existen: si quedara alguna, la FK
    // falla, la transacción se deshace y la siguiente pasada las borra primero.
    await client.contact.deleteMany({ where: { tenantId } });
    await client.integrationCredential.deleteMany({ where: { tenantId } });
    await client.eventInbox.deleteMany({ where: { channelId: { in: channelIds } } });
    await client.channel.deleteMany({ where: { tenantId } });
    await client.invitation.deleteMany({ where: { tenantId } });
    await client.outboxEvent.deleteMany({ where: { tenantId } });
    await client.deletionLog.deleteMany({ where: { tenantId } });

    // FK `RESTRICT` hacia `tenant_members`; `active_tenant_id` no tiene FK pero se suelta igual.
    await client.tenant.update({
      where: { id: tenantId },
      data: { deactivatedByMemberId: null },
      select: { id: true },
    });
    await client.session.updateMany({
      where: { activeTenantId: tenantId },
      data: { activeTenantId: null },
    });
    const members = await client.tenantMember.deleteMany({ where: { tenantId } });

    // `sessions.user_id` es `RESTRICT`; push y rechazos caen en cascada, el resto pasa a NULL.
    await client.session.deleteMany({ where: { userId: { in: orphanUserIds } } });
    const users = await client.user.deleteMany({ where: { id: { in: orphanUserIds } } });

    await client.tenant.delete({ where: { id: tenantId }, select: { id: true } });
    await client.tenantDeletion.update({
      where: { tenantId },
      data: {
        completedAt: at,
        lastError: null,
        membersDeleted: members.count,
        usersDeleted: users.count,
      },
      select: { id: true },
    });
    return { members: members.count, users: users.count };
  }

  async recordError(tenantId: string, error: string): Promise<void> {
    await this.db.client.tenantDeletion.updateMany({
      where: { tenantId },
      data: { lastError: error.slice(0, MAX_ERROR_LENGTH) },
    });
  }
}
