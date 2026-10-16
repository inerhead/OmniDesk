import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type {
  TenantContentCounts,
  TenantDeletionRecord,
  TenantDeletionRepository,
} from '../application/ports/tenant-deletion.repository';
import type { MemberAccount } from '../domain/tenant-purge';

const recordSelect = {
  id: true,
  tenantId: true,
  tenantName: true,
  tenantSlug: true,
  requestedByEmail: true,
  requestedAt: true,
  completedAt: true,
  lastError: true,
  membersDeleted: true,
  usersDeleted: true,
  conversationsDeleted: true,
  messagesDeleted: true,
  attachmentsDeleted: true,
  objectsDeleted: true,
} as const;

@Injectable()
export class PrismaTenantDeletionRepository implements TenantDeletionRepository {
  constructor(private readonly db: PrismaDb) {}

  async request(input: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    requestedByUserId: string;
    requestedByEmail: string;
    at: Date;
  }): Promise<void> {
    await this.db.client.tenant.update({
      where: { id: input.tenantId },
      data: { deletionRequestedAt: input.at },
    });
    await this.db.client.tenantDeletion.create({
      data: {
        tenantId: input.tenantId,
        tenantName: input.tenantName,
        tenantSlug: input.tenantSlug,
        requestedByUserId: input.requestedByUserId,
        requestedByEmail: input.requestedByEmail,
        requestedAt: input.at,
      },
      select: { id: true },
    });
  }

  list(): Promise<TenantDeletionRecord[]> {
    return this.db.client.tenantDeletion.findMany({
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      select: recordSelect,
    });
  }

  async memberAccounts(tenantId: string): Promise<MemberAccount[]> {
    // Todas las filas de la empresa, también las dadas de baja: su cuenta solo cuelga de aquí.
    const rows = await this.db.client.tenantMember.findMany({
      where: { tenantId, userId: { not: null } },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            _count: {
              select: {
                // Otra empresa activa salva la cuenta; una que también se está borrando, no.
                memberships: {
                  where: {
                    tenantId: { not: tenantId },
                    removedAt: null,
                    tenant: { deletionRequestedAt: null },
                  },
                },
              },
            },
          },
        },
      },
    });
    return rows.flatMap(({ user }) =>
      user
        ? [{ userId: user.id, email: user.email, otherActiveMemberships: user._count.memberships }]
        : [],
    );
  }

  async contentCounts(tenantId: string): Promise<TenantContentCounts | null> {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) return null;
    const [members, conversations, messages, attachments] = await Promise.all([
      this.db.client.tenantMember.count({ where: { tenantId } }),
      this.db.client.conversation.count({ where: { tenantId } }),
      this.db.client.message.count({ where: { tenantId } }),
      this.db.client.messageAttachment.count({ where: { tenantId } }),
    ]);
    return { members, conversations, messages, attachments };
  }
}
