import { Inject, Injectable, Optional } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { PLATFORM_ADMINS, type PlatformAdmins } from '../../../shared/application/platform-admins';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { ENV, type Env } from '../../../shared/config/env';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/application/ports/user.repository';
import { checkTenantDeletion, isOrphanAccount } from '../domain/tenant-purge';
import {
  PLATFORM_TENANT_REPOSITORY,
  type PlatformTenantRepository,
} from './ports/platform-tenant.repository';
import {
  TENANT_DELETION_REPOSITORY,
  type TenantDeletionRecord,
  type TenantDeletionRepository,
} from './ports/tenant-deletion.repository';
import { TENANT_PURGE_TRIGGER, type TenantPurgeTrigger } from './ports/tenant-purge-trigger';

export type RequestTenantDeletionResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'not-suspended' }
  | { kind: 'demo-locked' }
  | { kind: 'confirmation-mismatch' };

/**
 * Pide el borrado de una empresa suspendida (SPEC 20). En una transacción la marca en borrado, crea
 * la constancia y suelta las sesiones que la tenían activa; después despierta el job, que borra el
 * resto en segundo plano. Repetirlo con la empresa ya en borrado no cambia nada.
 */
@Injectable()
export class RequestTenantDeletionUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(PLATFORM_TENANT_REPOSITORY) private readonly tenants: PlatformTenantRepository,
    @Inject(TENANT_DELETION_REPOSITORY) private readonly deletions: TenantDeletionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ENV) private readonly env: Pick<Env, 'DEMO_MODE'>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(TENANT_PURGE_TRIGGER) private readonly purge?: TenantPurgeTrigger,
  ) {}

  async execute(
    adminUserId: string,
    tenantId: string,
    confirmSlug: string,
  ): Promise<RequestTenantDeletionResult> {
    const result = await this.tx.run(async (): Promise<RequestTenantDeletionResult> => {
      const tenant = await this.tenants.findForUpdate(tenantId);
      if (!tenant) return { kind: 'not-found' };
      const check = checkTenantDeletion(tenant, confirmSlug, this.env.DEMO_MODE);
      if (check === 'already-deleting') return { kind: 'ok' };
      if (check !== 'ok') return { kind: check };
      const admin = await this.users.findById(adminUserId);
      if (!admin) throw new Error(`Admin ${adminUserId} sin usuario`);
      await this.deletions.request({
        tenantId,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        requestedByUserId: adminUserId,
        requestedByEmail: admin.email,
        at: this.clock.now(),
      });
      await this.tenants.releaseSessions(tenantId);
      return { kind: 'ok' };
    });
    if (result.kind === 'ok') this.purge?.wake();
    return result;
  }
}

export interface TenantDeletionPreview {
  members: number;
  accountsToDelete: number;
  conversations: number;
  messages: number;
  attachments: number;
}

/** Lo que se borraría (SPEC 20), con la misma regla de cuentas huérfanas que el job. */
@Injectable()
export class PreviewTenantDeletionUseCase {
  constructor(
    @Inject(TENANT_DELETION_REPOSITORY) private readonly deletions: TenantDeletionRepository,
    @Inject(PLATFORM_ADMINS) private readonly admins: PlatformAdmins,
  ) {}

  async execute(tenantId: string): Promise<TenantDeletionPreview | null> {
    const counts = await this.deletions.contentCounts(tenantId);
    if (!counts) return null;
    const accounts = await this.deletions.memberAccounts(tenantId);
    const accountsToDelete = accounts.filter((account) =>
      isOrphanAccount(account, (email) => this.admins.isPlatformAdmin(email)),
    ).length;
    return { ...counts, accountsToDelete };
  }
}

/** Pestaña "Borradas" de `/platform`: todas las constancias, la más reciente primero. */
@Injectable()
export class ListTenantDeletionsUseCase {
  constructor(
    @Inject(TENANT_DELETION_REPOSITORY) private readonly deletions: TenantDeletionRepository,
  ) {}

  execute(): Promise<TenantDeletionRecord[]> {
    return this.deletions.list();
  }
}
