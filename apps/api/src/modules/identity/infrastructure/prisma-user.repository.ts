import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { UserRepository } from '../application/ports/user.repository';
import { normalizeEmail, type GoogleIdentity, type User } from '../domain/user';

const select = { id: true, email: true, displayName: true, avatarUrl: true } as const;

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaDb) {}

  findById(id: string): Promise<User | null> {
    return this.db.client.user.findUnique({ where: { id }, select });
  }

  async upsertFromGoogle(identity: GoogleIdentity): Promise<User> {
    const profile = { displayName: identity.displayName, avatarUrl: identity.avatarUrl };
    const byEmail = await this.db.client.user.findUnique({
      where: { email: identity.email },
      select: { id: true, googleSub: true },
    });
    // Mismo email sin cuenta de Google enlazada (p. ej. un usuario demo): se enlaza.
    if (byEmail && byEmail.googleSub === null) {
      return this.db.client.user.update({
        where: { id: byEmail.id },
        data: { googleSub: identity.googleSub, ...profile },
        select,
      });
    }
    return this.db.client.user.upsert({
      where: { googleSub: identity.googleSub },
      create: { googleSub: identity.googleSub, email: identity.email, ...profile },
      update: { email: identity.email, ...profile },
      select,
    });
  }

  upsertDemo(data: { email: string; displayName: string }): Promise<User> {
    const email = normalizeEmail(data.email);
    return this.db.client.user.upsert({
      where: { email },
      create: { email, displayName: data.displayName },
      update: { displayName: data.displayName },
      select,
    });
  }
}
