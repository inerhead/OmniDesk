import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { NewSession, SessionRepository } from '../application/ports/session.repository';
import type { Session } from '../domain/session';

const select = {
  id: true,
  userId: true,
  activeTenantId: true,
  lastSeenAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: PrismaDb) {}

  create(data: NewSession): Promise<Session> {
    return this.db.client.session.create({ data, select });
  }

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.db.client.session.findUnique({ where: { tokenHash }, select });
  }

  async touch(id: string, window: Pick<Session, 'lastSeenAt' | 'expiresAt'>): Promise<void> {
    await this.db.client.session.update({ where: { id }, data: window });
  }

  async setActiveTenant(id: string, tenantId: string | null): Promise<void> {
    await this.db.client.session.update({ where: { id }, data: { activeTenantId: tenantId } });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.db.client.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeForUserInTenant(userId: string, tenantId: string, at: Date): Promise<number> {
    const { count } = await this.db.client.session.updateMany({
      where: { userId, activeTenantId: tenantId, revokedAt: null },
      data: { revokedAt: at },
    });
    return count;
  }
}
