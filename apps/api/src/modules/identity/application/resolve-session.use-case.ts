import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { isSessionActive, slideSession, type Session } from '../domain/session';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import { hashToken } from './session-token';

export interface ResolvedSession {
  session: Session;
  /** La ventana se extendió: hay que renovar la cookie. */
  renewed: boolean;
}

/** Sesión vigente para el token de la cookie, deslizando su expiración; `null` si no vale. */
@Injectable()
export class ResolveSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(token: string | undefined): Promise<ResolvedSession | null> {
    if (!token) return null;
    const session = await this.sessions.findByTokenHash(hashToken(token));
    const now = this.clock.now();
    if (!session || !isSessionActive(session, now)) return null;

    const window = slideSession(session, now);
    if (!window) return { session, renewed: false };
    await this.sessions.touch(session.id, window);
    return { session: { ...session, ...window }, renewed: true };
  }
}
