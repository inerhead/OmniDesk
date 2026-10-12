import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../../../shared/application/clock.port';
import { LAST_SEEN_THROTTLE_MS, SESSION_TTL_MS, type Session } from '../domain/session';
import type { Membership } from '../domain/user';
import { CreateSessionUseCase } from './create-session.use-case';
import type { MembershipRepository } from './ports/membership.repository';
import type { NewSession, SessionRepository } from './ports/session.repository';
import { ResolveActorUseCase } from './resolve-actor.use-case';
import { ResolveSessionUseCase } from './resolve-session.use-case';
import { RevokeSessionUseCase } from './revoke-session.use-case';
import { hashToken } from './session-token';

class FakeClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return this.current;
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class InMemorySessions implements SessionRepository {
  rows: Array<Session & { tokenHash: string }> = [];
  touches = 0;

  async create(data: NewSession) {
    const row = { id: `s${this.rows.length + 1}`, revokedAt: null, ...data };
    this.rows.push(row);
    return row;
  }
  async findByTokenHash(tokenHash: string) {
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }
  async touch(id: string, window: Pick<Session, 'lastSeenAt' | 'expiresAt'>) {
    this.touches += 1;
    Object.assign(
      this.rows.find((row) => row.id === id)!,
      window,
    );
  }
  async setActiveTenant(id: string, tenantId: string | null) {
    this.rows.find((row) => row.id === id)!.activeTenantId = tenantId;
  }
  async revoke(id: string, at: Date) {
    this.rows.find((row) => row.id === id)!.revokedAt = at;
  }
  async revokeForUserInTenant(userId: string, tenantId: string, at: Date) {
    const rows = this.rows.filter(
      (row) => row.userId === userId && row.activeTenantId === tenantId && !row.revokedAt,
    );
    for (const row of rows) row.revokedAt = at;
    return rows.length;
  }
}

const acme: Membership = {
  memberId: 'm1',
  tenantId: 't-acme',
  tenantName: 'Acme',
  tenantSlug: 'acme',
  role: 'ADMIN',
};

function memberships(list: Membership[]): MembershipRepository {
  return {
    listForUser: async () => list,
    findForUser: async (_userId, tenantId) => list.find((m) => m.tenantId === tenantId) ?? null,
    findByMemberId: async () => null,
    listLoginMembersOfTenant: async () => [],
  };
}

describe('sesiones', () => {
  let clock: FakeClock;
  let sessions: InMemorySessions;
  let create: CreateSessionUseCase;
  let resolve: ResolveSessionUseCase;

  beforeEach(() => {
    clock = new FakeClock(new Date('2026-10-12T10:00:00.000Z'));
    sessions = new InMemorySessions();
    create = new CreateSessionUseCase(sessions, memberships([acme]), clock);
    resolve = new ResolveSessionUseCase(sessions, clock);
  });

  it('guarda solo el sha256 del token, con la primera membresía como empresa activa', async () => {
    const { token, session } = await create.execute({ userId: 'u1', userAgent: 'Vitest' });

    expect(token).toMatch(/^[\w-]{43}$/);
    expect(sessions.rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(sessions.rows)).not.toContain(token);
    expect(session.activeTenantId).toBe('t-acme');
  });

  it('cada login genera un token distinto', async () => {
    const a = await create.execute({ userId: 'u1' });
    const b = await create.execute({ userId: 'u1' });

    expect(a.token).not.toBe(b.token);
  });

  it('sin membresías la sesión no tiene empresa activa', async () => {
    const lonely = new CreateSessionUseCase(sessions, memberships([]), clock);

    expect((await lonely.execute({ userId: 'u1' })).session.activeTenantId).toBeNull();
  });

  it('resuelve una sesión vigente y solo la desliza cada 5 min', async () => {
    const { token } = await create.execute({ userId: 'u1' });

    clock.advance(LAST_SEEN_THROTTLE_MS - 1);
    expect(await resolve.execute(token)).toMatchObject({ renewed: false });
    expect(sessions.touches).toBe(0);

    clock.advance(1);
    const resolved = await resolve.execute(token);
    expect(resolved?.renewed).toBe(true);
    expect(resolved?.session.expiresAt).toEqual(new Date(clock.now().getTime() + SESSION_TTL_MS));
    expect(sessions.touches).toBe(1);
  });

  it('una sesión sin uso durante 30 días expira', async () => {
    const { token } = await create.execute({ userId: 'u1' });

    clock.advance(SESSION_TTL_MS);

    expect(await resolve.execute(token)).toBeNull();
  });

  it('un token desconocido o ausente no resuelve nada', async () => {
    expect(await resolve.execute('desconocido')).toBeNull();
    expect(await resolve.execute(undefined)).toBeNull();
  });

  it('el logout revoca la sesión', async () => {
    const { token } = await create.execute({ userId: 'u1' });

    await new RevokeSessionUseCase(sessions, clock).execute(token);

    expect(await resolve.execute(token)).toBeNull();
  });
});

describe('ResolveActorUseCase', () => {
  const resolveActor = new ResolveActorUseCase(memberships([acme]));

  it('el actor es la membresía de la empresa activa', async () => {
    expect(await resolveActor.execute({ userId: 'u1', activeTenantId: 't-acme' })).toEqual({
      kind: 'ok',
      actor: { userId: 'u1', tenantId: 't-acme', memberId: 'm1', role: 'ADMIN' },
    });
  });

  it('sin empresa activa, o sin membresía en ella, no hay actor', async () => {
    expect(await resolveActor.execute({ userId: 'u1', activeTenantId: null })).toEqual({
      kind: 'no-active-tenant',
    });
    expect(await resolveActor.execute({ userId: 'u1', activeTenantId: 't-otra' })).toEqual({
      kind: 'no-active-tenant',
    });
  });
});
