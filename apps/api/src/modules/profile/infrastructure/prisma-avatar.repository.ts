import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { AvatarOwner, AvatarRepository } from '../application/ports/avatar.repository';

@Injectable()
export class PrismaAvatarRepository implements AvatarRepository {
  constructor(private readonly db: PrismaDb) {}

  findOwner(userId: string): Promise<AvatarOwner | null> {
    return this.db.client.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true, googleSub: true },
    });
  }

  async replace(
    userId: string,
    next: { key: string; at: Date } | null,
  ): Promise<{ previousKey: string | null }> {
    // Lee la clave vieja y escribe la nueva en una sola sentencia, con la fila bloqueada.
    const rows = await this.db.client.$queryRaw<Array<{ previous_key: string | null }>>`
      UPDATE users SET avatar_key = ${next?.key ?? null}, avatar_updated_at = ${next?.at ?? null}
      FROM (SELECT id, avatar_key FROM users WHERE id = ${userId}::uuid FOR UPDATE) AS old
      WHERE users.id = old.id
      RETURNING old.avatar_key AS previous_key`;
    return { previousKey: rows[0]?.previous_key ?? null };
  }

  async sharesTenant(
    viewerUserId: string,
    targetUserId: string,
    tenantId: string,
  ): Promise<boolean> {
    const [viewer, target] = await Promise.all([
      this.db.client.tenantMember.count({
        where: { tenantId, userId: viewerUserId, removedAt: null },
      }),
      this.db.client.tenantMember.count({ where: { tenantId, userId: targetUserId } }),
    ]);
    return viewer > 0 && target > 0;
  }
}
