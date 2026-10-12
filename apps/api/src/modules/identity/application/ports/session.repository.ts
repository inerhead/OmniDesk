import type { Session } from '../../domain/session';

export interface NewSession {
  tokenHash: string;
  userId: string;
  activeTenantId: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface SessionRepository {
  create(data: NewSession): Promise<Session>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  touch(id: string, window: Pick<Session, 'lastSeenAt' | 'expiresAt'>): Promise<void>;
  setActiveTenant(id: string, tenantId: string | null): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  /** Revoca las sesiones del usuario cuya empresa activa es `tenantId` (al quitar al miembro). */
  revokeForUserInTenant(userId: string, tenantId: string, at: Date): Promise<number>;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
