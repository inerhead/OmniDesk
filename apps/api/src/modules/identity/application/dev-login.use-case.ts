import { Inject, Injectable } from '@nestjs/common';
import { DEMO_TENANT } from '../../demo/application/demo.constants';
import { CreateSessionUseCase, type CreatedSession } from './create-session.use-case';
import { DEMO_USERS, type DemoUser } from './demo-users';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';
import { USER_REPOSITORY, type UserRepository } from './ports/user.repository';

/**
 * Login de desarrollo (solo `DEMO_MODE=true`, lo comprueba el controlador): una sesión real para un
 * miembro del tenant demo, o para un usuario demo sin empresa (SPEC 18). `null` si el miembro no es
 * del tenant demo o no tiene usuario.
 */
@Injectable()
export class DevLoginUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly createSession: CreateSessionUseCase,
  ) {}

  /** Usuario demo sin empresa (SPEC 18). `null` si la semilla aún no lo creó. */
  async executeDemoUser(
    demoUser: DemoUser,
    userAgent: string | null,
  ): Promise<CreatedSession | null> {
    const [userId] = await this.users.findIdsByEmails([DEMO_USERS[demoUser].email]);
    if (!userId) return null;
    return this.createSession.execute({ userId, userAgent });
  }

  listDemoUsers(): Array<{ demoUser: DemoUser; displayName: string }> {
    return (Object.keys(DEMO_USERS) as DemoUser[]).map((demoUser) => ({
      demoUser,
      displayName: DEMO_USERS[demoUser].displayName,
    }));
  }

  async execute(memberId: string, userAgent: string | null): Promise<CreatedSession | null> {
    const membership = await this.memberships.findByMemberId(memberId);
    if (!membership?.userId || membership.tenantSlug !== DEMO_TENANT.slug) return null;
    // Con la demo inactiva (SPEC 16) no hay login de desarrollo.
    if (!membership.tenantActive) return null;
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
