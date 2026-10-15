import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import { toRetentionDays } from '../../tenancy/domain/retention';
import type {
  DeletedConversations,
  RetentionStore,
  TechnicalPurgeResult,
  TenantRetention,
} from '../application/ports/retention-store';

@Injectable()
export class PrismaRetentionStore implements RetentionStore {
  constructor(private readonly db: PrismaDb) {}

  async tenantsWithRetention(): Promise<TenantRetention[]> {
    const rows = await this.db.client.tenant.findMany({
      where: { retentionDays: { not: null } },
      select: { id: true, retentionDays: true },
      orderBy: { id: 'asc' },
    });
    return rows.flatMap((row) => {
      const retentionDays = toRetentionDays(row.retentionDays);
      return retentionDays === null ? [] : [{ tenantId: row.id, retentionDays }];
    });
  }

  async lockExpiredConversations(tenantId: string, cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.db.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM conversations
      WHERE tenant_id = ${tenantId}::uuid AND status = 'CLOSED' AND last_message_at < ${cutoff}
      ORDER BY last_message_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((row) => row.id);
  }

  async attachmentKeys(tenantId: string, conversationIds: string[]): Promise<string[]> {
    const rows = await this.db.client.messageAttachment.findMany({
      where: {
        tenantId,
        storageKey: { not: null },
        message: { conversationId: { in: conversationIds } },
      },
      select: { storageKey: true },
    });
    return rows.flatMap((row) => (row.storageKey ? [row.storageKey] : []));
  }

  async deleteConversations(
    tenantId: string,
    conversationIds: string[],
  ): Promise<DeletedConversations> {
    const messages = await this.db.client.message.count({
      where: { tenantId, conversationId: { in: conversationIds } },
    });
    const { count } = await this.db.client.conversation.deleteMany({
      where: { tenantId, id: { in: conversationIds } },
    });
    return { conversations: count, messages };
  }

  async deleteOrphanContacts(tenantId: string): Promise<number> {
    const { count } = await this.db.client.contact.deleteMany({
      where: { tenantId, conversations: { none: {} } },
    });
    return count;
  }

  async logDeletion(entry: {
    tenantId: string;
    kind: 'contact' | 'retention';
    actorMemberId: string | null;
    conversationsDeleted: number;
    messagesDeleted: number;
  }): Promise<void> {
    await this.db.client.deletionLog.create({ data: entry, select: { id: true } });
  }

  async lockContactConversations(tenantId: string, contactId: string): Promise<string[] | null> {
    const contact = await this.db.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM contacts WHERE id = ${contactId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`;
    if (contact.length === 0) return null;
    const rows = await this.db.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM conversations
      WHERE tenant_id = ${tenantId}::uuid AND contact_id = ${contactId}::uuid
      ORDER BY id
      FOR UPDATE`;
    return rows.map((row) => row.id);
  }

  async deleteContact(tenantId: string, contactId: string): Promise<void> {
    await this.db.client.contact.deleteMany({ where: { id: contactId, tenantId } });
  }

  async purgeTechnical(cutoff: Date): Promise<TechnicalPurgeResult> {
    const before = { lt: cutoff };
    const [outbox, inbox, sessions, invitations] = await Promise.all([
      this.db.client.outboxEvent.deleteMany({ where: { publishedAt: before } }),
      this.db.client.eventInbox.deleteMany({ where: { receivedAt: before } }),
      this.db.client.session.deleteMany({
        where: { OR: [{ expiresAt: before }, { revokedAt: before }] },
      }),
      this.db.client.invitation.deleteMany({
        where: { OR: [{ acceptedAt: before }, { revokedAt: before }, { expiresAt: before }] },
      }),
    ]);
    return {
      outboxEvents: outbox.count,
      inboxEvents: inbox.count,
      sessions: sessions.count,
      invitations: invitations.count,
    };
  }

  async deleteTenantRejectionsBefore(cutoff: Date): Promise<number> {
    const { count } = await this.db.client.tenantRejection.deleteMany({
      where: { rejectedAt: { lt: cutoff } },
    });
    return count;
  }
}
