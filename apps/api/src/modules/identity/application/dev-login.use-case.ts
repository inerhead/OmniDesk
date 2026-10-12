import { Inject, Injectable } from '@nestjs/common';
import { DEMO_TENANT } from '../../demo/application/demo.constants';
import { CreateSessionUseCase, type CreatedSession } from './create-session.use-case';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';

/**
 * Login de desarrollo (solo `DEMO_MODE=true`, lo comprueba el controlador): una sesión real para un
 * miembro del tenant demo. `null` si el miembro no es del tenant demo o no tiene usuario.
 */
@Injectable()
export class DevLoginUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    private readonly createSession: CreateSessionUseCase,
  ) {}

  async execute(memberId: string, userAgent: string | null): Promise<CreatedSession | null> {
    const membership = await this.memberships.findByMemberId(memberId);
    if (!membership?.userId || membership.tenantSlug !== DEMO_TENANT.slug) return null;
    return this.createSession.execute({
      userId: membership.userId,
      activeTenantId: membership.tenantId,
      userAgent,
    });
  }

  listMembers() {
    return this.memberships.listLoginMembersOfTenant(DEMO_TENANT.slug);
  }
}
