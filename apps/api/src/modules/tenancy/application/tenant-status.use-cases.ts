import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { OUTBOX_PORT, type OutboxPort } from '../../../shared/application/outbox.port';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import { canManageTenant, confirmsTenantName } from '../domain/tenant-policy';
import type { TenantDetailsResult } from './manage-tenant.use-cases';
import { TENANT_REPOSITORY, type TenantRepository } from './ports/tenant.repository';

/** Las apps abiertas de la empresa vuelven a pedir `/me` (SPEC 16). */
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

export type DeactivateTenantResult = TenantDetailsResult | { kind: 'confirmation-mismatch' };

/**
 * Inactiva la empresa activa: corta el acceso de Admin y Agent, la atención y los envíos. En la misma
 * transacción revoca las invitaciones pendientes y avisa por tiempo real. Repetir no cambia nada.
 */
@Injectable()
export class DeactivateTenantUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext, confirmName: string): Promise<DeactivateTenantResult> {
    if (!canManageTenant(actor.role)) return { kind: 'forbidden' };
    return this.tx.run(async () => {
      const current = await this.tenants.findDetails(actor.tenantId);
      if (!current) return { kind: 'not-found' } as const;
      if (!confirmsTenantName(current.name, confirmName)) {
        return { kind: 'confirmation-mismatch' } as const;
      }
      const now = this.clock.now();
      if (await this.tenants.deactivate(actor.tenantId, actor.memberId, now)) {
        await this.tenants.revokePendingInvitations(actor.tenantId, now);
        await enqueueStatusChanged(this.outbox, actor.tenantId, false, now);
      }
      const tenant = await this.tenants.findDetails(actor.tenantId);
      return tenant ? ({ kind: 'ok', tenant } as const) : ({ kind: 'not-found' } as const);
    });
  }
}

/** Puerto: reencola los envíos cortados por la inactivación que aún se pueden enviar (SPEC 16). */
export interface TenantInactiveRequeuer {
  /** Devuelve cuántos mensajes volvieron a `PENDING`. Debe llamarse dentro de la transacción. */
  requeueTenantInactive(tenantId: string, now: Date): Promise<number>;
}

export const TENANT_INACTIVE_REQUEUER = Symbol('TENANT_INACTIVE_REQUEUER');

/** Reactiva la empresa: vuelve el acceso y se reenvían los mensajes cortados con la ventana abierta. */
@Injectable()
export class ReactivateTenantUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(TENANT_INACTIVE_REQUEUER) private readonly requeuer: TenantInactiveRequeuer,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext): Promise<TenantDetailsResult> {
    if (!canManageTenant(actor.role)) return { kind: 'forbidden' };
    return this.tx.run(async () => {
      const now = this.clock.now();
      if (await this.tenants.reactivate(actor.tenantId)) {
        await this.requeuer.requeueTenantInactive(actor.tenantId, now);
        await enqueueStatusChanged(this.outbox, actor.tenantId, true, now);
      }
      const tenant = await this.tenants.findDetails(actor.tenantId);
      return tenant ? ({ kind: 'ok', tenant } as const) : ({ kind: 'not-found' } as const);
    });
  }
}
