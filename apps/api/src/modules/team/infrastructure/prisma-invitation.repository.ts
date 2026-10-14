import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import {
  memberRefSelect,
  toMemberRef,
  type MemberRefRow,
} from '../../identity/infrastructure/member-ref';
import type {
  Invitation,
  InvitationRepository,
  InvitationWithTenant,
} from '../application/ports/invitation.repository';
import type { InvitableRole } from '../domain/team-policy';

const select = {
  id: true,
  tenantId: true,
  email: true,
  role: true,
  createdAt: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  invitedBy: { select: memberRefSelect },
} as const;

// El esquema admite cualquier MemberRole; la aplicación solo crea ADMIN o AGENT.
const toInvitation = <T extends { role: string; invitedBy: MemberRefRow }>(row: T) =>
  ({ ...row, role: row.role as InvitableRole, invitedBy: toMemberRef(row.invitedBy) }) as Omit<
    T,
    'role' | 'invitedBy'
  > & { role: InvitableRole; invitedBy: ReturnType<typeof toMemberRef> };

@Injectable()
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly db: PrismaDb) {}

  async create(data: {
    tenantId: string;
    email: string;
    role: InvitableRole;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<Invitation> {
    return toInvitation(await this.db.client.invitation.create({ data, select }));
  }

  async listPending(tenantId: string, now: Date): Promise<Invitation[]> {
    const rows = await this.db.client.invitation.findMany({
      where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select,
    });
    return rows.map(toInvitation);
  }

  async findById(tenantId: string, id: string): Promise<Invitation | null> {
    const row = await this.db.client.invitation.findFirst({ where: { id, tenantId }, select });
    return row ? toInvitation(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationWithTenant | null> {
    const row = await this.db.client.invitation.findUnique({
      where: { tokenHash },
      select: { ...select, tenant: { select: { name: true } } },
    });
    if (!row) return null;
    const { tenant, ...invitation } = row;
    return { ...toInvitation(invitation), tenantName: tenant.name };
  }

  async markAccepted(id: string, at: Date): Promise<boolean> {
    const { count } = await this.db.client.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null, expiresAt: { gt: at } },
      data: { acceptedAt: at },
    });
    return count === 1;
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.db.client.invitation.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
