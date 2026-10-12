import { Inject, Injectable } from '@nestjs/common';
import type { GoogleIdentity } from '../domain/user';
import { CreateSessionUseCase, type CreatedSession } from './create-session.use-case';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';
import { USER_REPOSITORY, type UserRepository } from './ports/user.repository';

/** Tras el callback de Google: crea o actualiza el usuario y abre una sesión nueva. */
@Injectable()
export class GoogleLoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    private readonly createSession: CreateSessionUseCase,
  ) {}

  async execute(
    identity: GoogleIdentity,
    userAgent: string | null,
  ): Promise<CreatedSession & { hasMemberships: boolean }> {
    const user = await this.users.upsertFromGoogle(identity);
    const memberships = await this.memberships.listForUser(user.id);
    const created = await this.createSession.execute({
      userId: user.id,
      ...(memberships[0] && { activeTenantId: memberships[0].tenantId }),
      userAgent,
    });
    return { ...created, hasMemberships: memberships.length > 0 };
  }
}
