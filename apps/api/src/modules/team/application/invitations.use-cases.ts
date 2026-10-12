import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import type { ActorContext, SessionContext } from '../../../shared/application/request-context';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../shared/application/transaction-runner.port';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from '../../identity/application/ports/session.repository';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/application/ports/user.repository';
import { hashToken, newOpaqueToken } from '../../identity/application/session-token';
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from '../../members/application/ports/member.repository';
import {
  canInvite,
  canListInvitations,
  canRevokeInvitation,
  INVITATION_TTL_MS,
  isInvitationPending,
  maskEmail,
  type InvitableRole,
} from '../domain/team-policy';
import {
  INVITATION_REPOSITORY,
  type Invitation,
  type InvitationRepository,
} from './ports/invitation.repository';

export type CreateInvitationResult =
  | { kind: 'ok'; invitation: Invitation; token: string }
  | { kind: 'forbidden' }
  | { kind: 'already-member' };

/** Invitación por enlace a la empresa activa: 7 días, un solo uso y ligada al email. */
@Injectable()
export class CreateInvitationUseCase {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    actor: ActorContext,
    input: { email: string; role: InvitableRole },
  ): Promise<CreateInvitationResult> {
    if (!canInvite(actor.role, input.role)) return { kind: 'forbidden' };
    const email = input.email.trim().toLowerCase();
    if (await this.members.findActiveByEmail(actor.tenantId, email)) {
      return { kind: 'already-member' };
    }
    const token = newOpaqueToken();
    const invitation = await this.invitations.create({
      tenantId: actor.tenantId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: actor.memberId,
      expiresAt: new Date(this.clock.now().getTime() + INVITATION_TTL_MS),
    });
    return { kind: 'ok', invitation, token };
  }
}

@Injectable()
export class ListInvitationsUseCase {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext): Promise<Invitation[] | 'forbidden'> {
    if (!canListInvitations(actor.role)) return 'forbidden';
    return this.invitations.listPending(actor.tenantId, this.clock.now());
  }
}

@Injectable()
export class RevokeInvitationUseCase {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(actor: ActorContext, id: string): Promise<'ok' | 'forbidden' | 'not-found'> {
    if (!canListInvitations(actor.role)) return 'forbidden';
    const now = this.clock.now();
    const invitation = await this.invitations.findById(actor.tenantId, id);
    if (!invitation || !isInvitationPending(invitation, now)) return 'not-found';
    if (!canRevokeInvitation(actor.role, invitation.role)) return 'forbidden';
    await this.invitations.revoke(id, now);
    return 'ok';
  }
}

export interface InvitationPreview {
  tenantName: string;
  role: InvitableRole;
  emailMasked: string;
  expired: boolean;
}

/** Vista previa pública del enlace; `null` si el token no existe. */
@Injectable()
export class PreviewInvitationUseCase {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<InvitationPreview | null> {
    const invitation = await this.invitations.findByTokenHash(hashToken(token));
    if (!invitation) return null;
    return {
      tenantName: invitation.tenantName,
      role: invitation.role,
      emailMasked: maskEmail(invitation.email),
      expired: !isInvitationPending(invitation, this.clock.now()),
    };
  }
}

export type AcceptInvitationResult =
  | { kind: 'ok'; tenantId: string }
  | { kind: 'not-found' }
  /** Vencida, ya usada o revocada. */
  | { kind: 'expired' }
  | { kind: 'email-mismatch' }
  | { kind: 'already-member' };

/**
 * Acepta la invitación con la sesión de un usuario del mismo email: crea su membresía (o reactiva la
 * dada de baja) y la empresa pasa a ser la activa.
 */
@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(session: SessionContext, token: string): Promise<AcceptInvitationResult> {
    const now = this.clock.now();
    const invitation = await this.invitations.findByTokenHash(hashToken(token));
    if (!invitation) return { kind: 'not-found' };
    if (!isInvitationPending(invitation, now)) return { kind: 'expired' };

    const user = await this.users.findById(session.userId);
    if (!user || user.email !== invitation.email) return { kind: 'email-mismatch' };
    if (await this.members.findActiveByEmail(invitation.tenantId, user.email)) {
      return { kind: 'already-member' };
    }

    return this.tx.run(async () => {
      if (!(await this.invitations.markAccepted(invitation.id, now))) {
        return { kind: 'expired' } as const;
      }
      await this.members.admit(invitation.tenantId, {
        email: user.email,
        displayName: user.displayName,
        role: invitation.role,
        userId: user.id,
      });
      await this.sessions.setActiveTenant(session.sessionId, invitation.tenantId);
      return { kind: 'ok', tenantId: invitation.tenantId } as const;
    });
  }
}
