import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import type { Session } from '../domain/session';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';

export type ActorResolution =
  | { kind: 'ok'; actor: ActorContext }
  /** La empresa activa está inactiva (SPEC 16): solo sus OWNER entran, y solo a reactivarla. */
  | { kind: 'inactive'; actor: ActorContext }
  /** En revisión o suspendida por la plataforma (SPEC 18): nadie entra, ni el OWNER. */
  | { kind: 'pending'; actor: ActorContext }
  | { kind: 'suspended'; actor: ActorContext }
  /** La sesión no tiene empresa activa o ya no es miembro activo de ella. */
  | { kind: 'no-active-tenant' };

/** Actor de una sesión: su membresía activa en la empresa activa. */
@Injectable()
export class ResolveActorUseCase {
  constructor(@Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository) {}

  async execute(session: Pick<Session, 'userId' | 'activeTenantId'>): Promise<ActorResolution> {
    if (!session.activeTenantId) return { kind: 'no-active-tenant' };
    const membership = await this.memberships.findForUser(session.userId, session.activeTenantId);
    if (!membership) return { kind: 'no-active-tenant' };
    const actor: ActorContext = {
      userId: session.userId,
      tenantId: membership.tenantId,
      memberId: membership.memberId,
      role: membership.role,
    };
    const state = membership.tenantState;
    return { kind: state === 'active' ? 'ok' : state, actor };
  }
}
