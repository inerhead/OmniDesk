import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { UniqueConflictError } from '../../../shared/application/errors';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import { PLATFORM_ADMINS, type PlatformAdmins } from '../../../shared/application/platform-admins';
import { enqueuePlatformPush } from '../../../shared/application/platform-push';
import type { SessionContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  MEMBERSHIP_REPOSITORY,
  type MembershipRepository,
} from '../../identity/application/ports/membership.repository';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../../identity/application/ports/session.repository';
import {
  TENANT_REJECTION_REPOSITORY,
  type TenantRejectionRepository,
} from '../../identity/application/ports/tenant-rejection.repository';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/application/ports/user.repository';
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from '../../members/application/ports/member.repository';
import type { Membership } from '../../identity/domain/user';
import type { Tenant } from '../domain/tenant';
import { canCreateTenant } from '../domain/tenant-policy';
import { TENANT_REPOSITORY, type TenantRepository } from './ports/tenant.repository';

export type CreateTenantResult =
  | { kind: 'ok'; tenant: Tenant }
  | { kind: 'slug-taken' }
  | { kind: 'user-not-found' }
  | { kind: 'forbidden' }
  /** Ya es OWNER de una empresa en revisión (SPEC 18): una solicitud a la vez. */
  | { kind: 'request-pending' };

/**
 * Alta de empresa en autoservicio: quien la crea queda OWNER y pasa a ser su empresa activa. Solo puede
 * quien aún no tiene empresa o es OWNER en alguna (`canCreateTenant`). Queda en revisión y se avisa a
 * los admins de plataforma; la de un admin nace aprobada (SPEC 18). El email de contacto es el del
 * login, y enviarla cierra el aviso de un rechazo anterior.
 */
@Injectable()
export class CreateTenantUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(TENANT_REJECTION_REPOSITORY) private readonly rejections: TenantRejectionRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(PLATFORM_ADMINS) private readonly admins: PlatformAdmins,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    session: SessionContext,
    input: { name: string; slug: string; contactPhone: string },
  ): Promise<CreateTenantResult> {
    try {
      return await this.tx.run(async () => {
        const user = await this.users.findById(session.userId);
        if (!user) return { kind: 'user-not-found' } as const;
        const memberships = await this.memberships.listForUser(user.id);
        if (!canCreateTenant(memberships.map(({ role }) => role))) {
          return { kind: 'forbidden' } as const;
        }
        if (hasPendingRequest(memberships)) return { kind: 'request-pending' } as const;
        if (await this.tenants.findBySlug(input.slug)) return { kind: 'slug-taken' } as const;

        const now = this.clock.now();
        const byAdmin = this.admins.isPlatformAdmin(user.email);
        const tenant = await this.tenants.create({
          name: input.name,
          slug: input.slug,
          contactPhone: input.contactPhone,
          contactEmail: user.email,
          approval: byAdmin ? 'APPROVED' : 'PENDING',
          approvedAt: byAdmin ? now : null,
          approvedByUserId: byAdmin ? user.id : null,
        });
        await this.members.upsertByEmail(tenant.id, {
          displayName: user.displayName,
          email: user.email,
          role: 'OWNER',
          userId: user.id,
        });
        await this.sessions.setActiveTenant(session.sessionId, tenant.id);
        await this.rejections.dismissForUser(user.id, now);
        if (!byAdmin) {
          await enqueuePlatformPush(this.outbox, tenant.id, {
            userIds: await this.users.findIdsByEmails(this.admins.list()),
            title: 'Nueva solicitud de empresa',
            body: `${tenant.name} · ${user.email}`,
            url: '/platform',
            tag: `tenant-request-${tenant.id}`,
          });
        }
        return { kind: 'ok', tenant } as const;
      });
    } catch (error) {
      // Dos altas simultáneas con el mismo slug: la segunda choca con la restricción única.
      if (error instanceof UniqueConflictError) return { kind: 'slug-taken' };
      throw error;
    }
  }
}

function hasPendingRequest(memberships: Membership[]): boolean {
  return memberships.some(
    (membership) => membership.role === 'OWNER' && membership.tenantState === 'pending',
  );
}
