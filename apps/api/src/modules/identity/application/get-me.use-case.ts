import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { PLATFORM_ADMINS, type PlatformAdmins } from '../../../shared/application/platform-admins';
import type { SessionContext } from '../../../shared/application/request-context';
import { canSeeMembership, fallbackTenantId, type Membership, type User } from '../domain/user';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';
import { PLATFORM_OVERVIEW, type PlatformOverview } from './ports/platform-overview.port';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import {
  TENANT_REJECTION_REPOSITORY,
  type OpenTenantRejection,
  type TenantRejectionRepository,
} from './ports/tenant-rejection.repository';
import { USER_REPOSITORY, type UserRepository } from './ports/user.repository';

export interface MeView {
  user: User;
  memberships: Membership[];
  activeTenantId: string | null;
  /** SPEC 18. */
  isPlatformAdmin: boolean;
  platformPendingCount: number | null;
  tenantRejection: OpenTenantRejection | null;
}

/**
 * Usuario de la sesión con sus membresías activas. Una empresa inactiva solo aparece para sus OWNER;
 * una en revisión o suspendida, para todos sus miembros (SPEC 18). Si la empresa activa ya no es
 * válida (lo quitaron, se inactivó o se rechazó), la sesión pasa a la de respaldo, o a ninguna.
 */
@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(TENANT_REJECTION_REPOSITORY) private readonly rejections: TenantRejectionRepository,
    @Inject(PLATFORM_OVERVIEW) private readonly platform: PlatformOverview,
    @Inject(PLATFORM_ADMINS) private readonly admins: PlatformAdmins,
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
    const isPlatformAdmin = this.admins.isPlatformAdmin(user.email);
    const [platformPendingCount, tenantRejection] = await Promise.all([
      isPlatformAdmin ? this.platform.countPendingTenants() : null,
      this.rejections.findOpenForUser(user.id),
    ]);
    return {
      user,
      memberships,
      activeTenantId,
      isPlatformAdmin,
      platformPendingCount,
      tenantRejection,
    };
  }
}

/** Cierra el aviso de rechazo del usuario (SPEC 18). Repetirlo no cambia nada. */
@Injectable()
export class DismissTenantRejectionUseCase {
  constructor(
    @Inject(TENANT_REJECTION_REPOSITORY) private readonly rejections: TenantRejectionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(session: SessionContext): Promise<void> {
    return this.rejections.dismissForUser(session.userId, this.clock.now());
  }
}
