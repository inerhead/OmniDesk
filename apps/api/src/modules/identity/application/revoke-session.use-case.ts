import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock.port';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session.repository';
import { hashToken } from './session-token';

/** Cierra la sesión del token (logout). Sin token o con uno desconocido no hace nada. */
@Injectable()
export class RevokeSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(token: string | undefined): Promise<void> {
    if (!token) return;
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (session && session.revokedAt === null) {
      await this.sessions.revoke(session.id, this.clock.now());
    }
  }
}
