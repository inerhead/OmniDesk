import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import { enqueuePlatformPush } from '../../../shared/application/platform-push';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { RequeueTenantInactiveUseCase } from '../../conversations/application/requeue-tenant-inactive.use-case';
import {
  TENANT_REJECTION_REPOSITORY,
  tenantRejectionCutoff,
  type TenantRejectionRepository,
} from '../../identity/application/ports/tenant-rejection.repository';
import type { PlatformTenant } from '../domain/platform-tenant';
import {
  PLATFORM_TENANT_REPOSITORY,
  type PlatformTenantRepository,
} from './ports/platform-tenant.repository';

/** Fila de una pestaña de `/platform`: una empresa o, en Rechazadas, un rechazo. */
export type PlatformListItem =
  | { kind: 'tenant'; tenant: PlatformTenant }
  | {
      kind: 'rejection';
      rejection: Awaited<ReturnType<TenantRejectionRepository['listSince']>>[number];
    };

export type PlatformActionResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'not-pending' }
  | { kind: 'not-approved' }
  /** En borrado (SPEC 20): ya no se suspende ni se levanta la suspensión. */
  | { kind: 'deleting' };

/** Las apps abiertas de la empresa vuelven a pedir `/me` (SPEC 16 y 18). */
async function enqueueStatusChanged(
  outbox: OutboxPort,
  tenantId: string,
  active: boolean,
  at: Date,
): Promise<void> {
  await outbox.enqueue({
    tenantId,
    type: 'tenant.status_changed',
    payload: { type: 'tenant.status_changed', tenantId, active, occurredAt: at.toISOString() },
  });
}

const requestTag = (tenantId: string) => `tenant-request-${tenantId}`;

/** Pestañas de `/platform`. Rechazadas: solo las de los últimos 20 días. */
@Injectable()
export class ListPlatformTenantsUseCase {
  constructor(
    @Inject(PLATFORM_TENANT_REPOSITORY) private readonly tenants: PlatformTenantRepository,
    @Inject(TENANT_REJECTION_REPOSITORY) private readonly rejections: TenantRejectionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(status: 'pending' | 'approved' | 'rejected'): Promise<PlatformListItem[]> {
    if (status === 'rejected') {
      const rows = await this.rejections.listSince(tenantRejectionCutoff(this.clock.now()));
      return rows.map((rejection) => ({ kind: 'rejection', rejection }));
    }
    const rows =
      status === 'pending' ? await this.tenants.listPending() : await this.tenants.listApproved();
    return rows.map((tenant) => ({ kind: 'tenant', tenant }));
  }
}

/** Aprueba una solicitud y avisa al solicitante. */
@Injectable()
export class ApproveTenantUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(PLATFORM_TENANT_REPOSITORY) private readonly tenants: PlatformTenantRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(adminUserId: string, tenantId: string): Promise<PlatformActionResult> {
    return this.tx.run(async () => {
      const tenant = await this.tenants.findForUpdate(tenantId);
      if (!tenant) return { kind: 'not-found' };
      if (tenant.approval !== 'PENDING') return { kind: 'not-pending' };
      await this.tenants.approve(tenantId, adminUserId, this.clock.now());
      if (tenant.requester?.userId) {
        await enqueuePlatformPush(this.outbox, tenantId, {
          userIds: [tenant.requester.userId],
          title: 'Empresa aprobada',
          body: `Ya puedes usar ${tenant.name}`,
          url: '/conversations',
          tag: requestTag(tenantId),
        });
      }
      return { kind: 'ok' };
    });
  }
}

/**
 * Rechaza una solicitud: guarda el rechazo, borra la empresa y su membresía (el slug queda libre) y
 * avisa al solicitante. Las sesiones que la tenían activa caen a otra en su siguiente `/me`.
 */
@Injectable()
export class RejectTenantUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(PLATFORM_TENANT_REPOSITORY) private readonly tenants: PlatformTenantRepository,
    @Inject(TENANT_REJECTION_REPOSITORY) private readonly rejections: TenantRejectionRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(adminUserId: string, tenantId: string, reason: string): Promise<PlatformActionResult> {
    return this.tx.run(async () => {
      const tenant = await this.tenants.findForUpdate(tenantId);
      if (!tenant) return { kind: 'not-found' };
      if (tenant.approval !== 'PENDING') return { kind: 'not-pending' };
      const now = this.clock.now();
      const requesterId = tenant.requester?.userId;
      if (requesterId) {
        await this.rejections.create({
          userId: requesterId,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          reason,
          contactPhone: tenant.contactPhone,
          contactEmail: tenant.contactEmail,
          requestedAt: tenant.requestedAt,
          rejectedAt: now,
          rejectedByUserId: adminUserId,
        });
      }
      await this.tenants.deletePending(tenantId);
      if (requesterId) {
        await enqueuePlatformPush(this.outbox, tenantId, {
          userIds: [requesterId],
          title: 'Solicitud rechazada',
          body: `${tenant.name}: ${reason}`,
          url: '/onboarding',
          tag: requestTag(tenantId),
        });
      }
      return { kind: 'ok' };
    });
  }
}

/**
 * Suspende una empresa aprobada: nadie entra, ni el Owner, y se corta la atención y los envíos. Las
 * sesiones la sueltan y las apps abiertas vuelven a pedir `/me`. Repetirlo no cambia nada.
 */
@Injectable()
export class SuspendTenantUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(PLATFORM_TENANT_REPOSITORY) private readonly tenants: PlatformTenantRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(adminUserId: string, tenantId: string, reason: string): Promise<PlatformActionResult> {
    return this.tx.run(async () => {
      const tenant = await this.tenants.findForUpdate(tenantId);
      if (!tenant) return { kind: 'not-found' };
      if (tenant.state === 'deleting') return { kind: 'deleting' };
      if (tenant.approval !== 'APPROVED') return { kind: 'not-approved' };
      const now = this.clock.now();
      if (await this.tenants.suspend(tenantId, { byUserId: adminUserId, reason, at: now })) {
        await this.tenants.releaseSessions(tenantId);
        await enqueueStatusChanged(this.outbox, tenantId, false, now);
      }
      return { kind: 'ok' };
    });
  }
}

/**
 * Levanta la suspensión. Si el Owner no la tenía inactiva, reencola los envíos cortados con la
 * ventana abierta; si la tenía, los deja para su reactivación (SPEC 16). Repetirlo no cambia nada.
 */
@Injectable()
export class UnsuspendTenantUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(PLATFORM_TENANT_REPOSITORY) private readonly tenants: PlatformTenantRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    private readonly requeuer: RequeueTenantInactiveUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(tenantId: string): Promise<PlatformActionResult> {
    return this.tx.run(async () => {
      const tenant = await this.tenants.findForUpdate(tenantId);
      if (!tenant) return { kind: 'not-found' };
      if (tenant.state === 'deleting') return { kind: 'deleting' };
      if (tenant.approval !== 'APPROVED') return { kind: 'not-approved' };
      const now = this.clock.now();
      if (await this.tenants.unsuspend(tenantId)) {
        // `tenant` se leyó suspendido: lo que queda por debajo es la inactivación del Owner.
        const inactive = (await this.tenants.findForUpdate(tenantId))?.state === 'inactive';
        if (inactive) await this.requeuer.handOverSuspendedToInactive(tenantId);
        else await this.requeuer.requeueTenantSuspended(tenantId, now);
        await enqueueStatusChanged(this.outbox, tenantId, !inactive, now);
      }
      return { kind: 'ok' };
    });
  }
}
