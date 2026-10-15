import { Inject, Injectable } from '@nestjs/common';
import type { SessionContext } from '../../../shared/application/request-context';
import { canSeeMembership } from '../domain/user';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';

/**
 * Cambia la empresa activa de la sesión. Solo a una de la que el usuario es miembro activo; a una
 * inactiva, solo si es su OWNER (para reactivarla).
 */
@Injectable()
export class SetActiveTenantUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute(session: SessionContext, tenantId: string): Promise<'ok' | 'not-member'> {
    const membership = await this.memberships.findForUser(session.userId, tenantId);
    if (!membership || !canSeeMembership(membership)) return 'not-member';
    await this.sessions.setActiveTenant(session.sessionId, tenantId);
    return 'ok';
  }
}
