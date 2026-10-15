import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { newSessionWindow, type Session } from '../domain/session';
import { canSeeMembership, fallbackTenantId } from '../domain/user';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from './ports/membership.repository';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import { hashToken, newOpaqueToken } from './session-token';

export interface CreatedSession {
  /** Va en la cookie; solo existe aquí. */
  token: string;
  session: Session;
}

/**
 * Abre una sesión nueva (un token nuevo en cada login: evita la fijación de sesión). Sin empresa
 * indicada, la activa es la de respaldo (`fallbackTenantId`).
 */
@Injectable()
export class CreateSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: string;
    activeTenantId?: string;
    userAgent?: string | null;
  }): Promise<CreatedSession> {
    const activeTenantId =
      input.activeTenantId ??
      fallbackTenantId((await this.memberships.listForUser(input.userId)).filter(canSeeMembership));
    const token = newOpaqueToken();
    const session = await this.sessions.create({
      tokenHash: hashToken(token),
      userId: input.userId,
      activeTenantId,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      ...newSessionWindow(this.clock.now()),
    });
    return { token, session };
  }
}
