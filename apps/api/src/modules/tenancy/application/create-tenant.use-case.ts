import { Inject, Injectable } from '@nestjs/common';
import { UniqueConflictError } from '../../../shared/application/errors';
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
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/application/ports/user.repository';
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from '../../members/application/ports/member.repository';
import type { Tenant } from '../domain/tenant';
import { canCreateTenant } from '../domain/tenant-policy';
import { TENANT_REPOSITORY, type TenantRepository } from './ports/tenant.repository';

export type CreateTenantResult =
  | { kind: 'ok'; tenant: Tenant }
  | { kind: 'slug-taken' }
  | { kind: 'user-not-found' }
  | { kind: 'forbidden' };

/**
 * Alta de empresa en autoservicio: quien la crea queda OWNER y pasa a ser su empresa activa. Solo puede
 * quien aún no tiene empresa o es OWNER en alguna (`canCreateTenant`).
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
  ) {}

  async execute(
    session: SessionContext,
    input: { name: string; slug: string },
  ): Promise<CreateTenantResult> {
    try {
      return await this.tx.run(async () => {
        const user = await this.users.findById(session.userId);
        if (!user) return { kind: 'user-not-found' } as const;
        const memberships = await this.memberships.listForUser(user.id);
        if (!canCreateTenant(memberships.map(({ role }) => role))) {
          return { kind: 'forbidden' } as const;
        }
        if (await this.tenants.findBySlug(input.slug)) return { kind: 'slug-taken' } as const;

        const tenant = await this.tenants.create(input);
        await this.members.upsertByEmail(tenant.id, {
          displayName: user.displayName,
          email: user.email,
          role: 'OWNER',
          userId: user.id,
        });
        await this.sessions.setActiveTenant(session.sessionId, tenant.id);
        return { kind: 'ok', tenant } as const;
      });
    } catch (error) {
      // Dos altas simultáneas con el mismo slug: la segunda choca con la restricción única.
      if (error instanceof UniqueConflictError) return { kind: 'slug-taken' };
      throw error;
    }
  }
}
