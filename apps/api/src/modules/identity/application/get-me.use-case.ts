import { Inject, Injectable } from '@nestjs/common';
import type { SessionContext } from '../../../shared/application/request-context';
import { canSeeMembership, fallbackTenantId, type Membership, type User } from '../domain/user';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import { USER_REPOSITORY, type UserRepository } from './ports/user.repository';

export interface MeView {
  user: User;
  memberships: Membership[];
  activeTenantId: string | null;
}

/**
 * Usuario de la sesión con sus membresías activas. Una empresa inactiva solo aparece para sus OWNER.
 * Si la empresa activa ya no es válida (lo quitaron o se inactivó), la sesión pasa a la primera
 * empresa activa, o a ninguna.
 */
@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute(session: SessionContext): Promise<MeView | null> {
    const user = await this.users.findById(session.userId);
    if (!user) return null;
    const memberships = (await this.memberships.listForUser(user.id)).filter(canSeeMembership);

    let activeTenantId = session.activeTenantId;
    if (!memberships.some((membership) => membership.tenantId === activeTenantId)) {
      activeTenantId = fallbackTenantId(memberships);
      if (activeTenantId !== session.activeTenantId) {
        await this.sessions.setActiveTenant(session.sessionId, activeTenantId);
      }
    }
    return { user, memberships, activeTenantId };
  }
}
