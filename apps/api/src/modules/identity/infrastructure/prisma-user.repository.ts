import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { UserRepository } from '../application/ports/user.repository';
import {
  normalizeEmail,
  resolveAvatarUrl,
  type GoogleIdentity,
  type User,
  type UserAvatarSource,
} from '../domain/user';

const select = {
  id: true,
  email: true,
  displayName: true,
  googleAvatarUrl: true,
  avatarKey: true,
  avatarUpdatedAt: true,
} as const;

type UserRow = UserAvatarSource & { email: string; displayName: string };

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: resolveAvatarUrl(row),
  };
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaDb) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.client.user.findUnique({ where: { id }, select });
    return row && toUser(row);
  }

  async upsertFromGoogle(identity: GoogleIdentity): Promise<User> {
    // Solo la foto de Google: la subida (`avatarKey`) no se toca.
    const profile = { displayName: identity.displayName, googleAvatarUrl: identity.avatarUrl };
    const byEmail = await this.db.client.user.findUnique({
      where: { email: identity.email },
      select: { id: true, googleSub: true },
    });
    // Mismo email sin cuenta de Google enlazada (p. ej. un usuario demo): se enlaza.
    if (byEmail && byEmail.googleSub === null) {
      return toUser(
        await this.db.client.user.update({
          where: { id: byEmail.id },
          data: { googleSub: identity.googleSub, ...profile },
          select,
        }),
      );
    }
    return toUser(
      await this.db.client.user.upsert({
        where: { googleSub: identity.googleSub },
        create: { googleSub: identity.googleSub, email: identity.email, ...profile },
        update: { email: identity.email, ...profile },
        select,
      }),
    );
  }

  async upsertDemo(data: { email: string; displayName: string }): Promise<User> {
    const email = normalizeEmail(data.email);
    return toUser(
      await this.db.client.user.upsert({
        where: { email },
        create: { email, displayName: data.displayName },
        update: { displayName: data.displayName },
        select,
      }),
    );
  }
}
