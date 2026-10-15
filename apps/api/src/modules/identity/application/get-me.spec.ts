import { describe, expect, it } from 'vitest';
import { PlatformAdmins } from '../../../shared/application/platform-admins';
import type { Membership } from '../domain/user';
import { GetMeUseCase } from './get-me.use-case';
import type { MembershipRepository } from './ports/membership.repository';
import type { SessionRepository } from './ports/session.repository';
import type { TenantRejectionRepository } from './ports/tenant-rejection.repository';
import type { UserRepository } from './ports/user.repository';

const user = { id: 'u1', email: 'ana@example.com', displayName: 'Ana', avatarUrl: null };

function membership(
  tenantId: string,
  tenantState: Membership['tenantState'],
  role: Membership['role'] = 'AGENT',
): Membership {
  return {
    memberId: `m-${tenantId}`,
    tenantId,
    tenantName: tenantId,
    tenantSlug: tenantId,
    role,
    tenantLogoUrl: null,
    tenantActive: tenantState === 'active',
    tenantState,
    suspensionReason: tenantState === 'suspended' ? 'Impago' : null,
    suspendedAt: null,
    requestedAt: null,
  };
}

function setup(
  list: Membership[],
  options: { admins?: string[]; pending?: number; rejection?: boolean } = {},
) {
  const activeChanges: Array<string | null> = [];
  const users = { findById: async () => user } as unknown as UserRepository;
  const memberships = { listForUser: async () => list } as unknown as MembershipRepository;
  const sessions = {
    setActiveTenant: async (_id: string, tenantId: string | null) => {
      activeChanges.push(tenantId);
    },
  } as unknown as SessionRepository;
  const rejections = {
    findOpenForUser: async () =>
      options.rejection
        ? { tenantName: 'Acme', reason: 'Datos falsos', rejectedAt: new Date('2026-10-15') }
        : null,
  } as unknown as TenantRejectionRepository;
  const getMe = new GetMeUseCase(
    users,
    memberships,
    sessions,
    rejections,
    { countPendingTenants: async () => options.pending ?? 0 },
    new PlatformAdmins(options.admins ?? []),
  );
  const run = (activeTenantId: string | null) =>
    getMe.execute({ sessionId: 's1', userId: user.id, activeTenantId });
  return { run, activeChanges };
}

describe('GetMeUseCase', () => {
  it('un Agent no ve una empresa inactiva y la sesión pasa a la primera activa', async () => {
    const { run, activeChanges } = setup([membership('a', 'inactive'), membership('b', 'active')]);

    const me = await run('a');

    expect(me!.memberships.map((m) => m.tenantId)).toEqual(['b']);
    expect(me!.activeTenantId).toBe('b');
    expect(activeChanges).toEqual(['b']);
  });

  it('una empresa suspendida sigue visible para un Agent y no se cambia si ya es la activa', async () => {
    const { run, activeChanges } = setup([membership('a', 'active'), membership('s', 'suspended')]);

    const me = await run('s');

    expect(me!.memberships.map((m) => m.tenantState)).toEqual(['active', 'suspended']);
    expect(me!.memberships[1]!.suspensionReason).toBe('Impago');
    expect(me!.activeTenantId).toBe('s');
    expect(activeChanges).toEqual([]);
  });

  it('sin empresa activa, el respaldo es la primera activa', async () => {
    const { run } = setup([membership('p', 'pending', 'OWNER'), membership('b', 'active')]);

    expect((await run(null))!.activeTenantId).toBe('b');
  });

  it('sin ninguna activa, el respaldo es la primera en revisión o suspendida', async () => {
    const { run } = setup([membership('p', 'pending', 'OWNER')]);

    expect((await run(null))!.activeTenantId).toBe('p');
  });

  it('sin otra, el OWNER de una empresa inactiva vuelve a ella para reactivarla', async () => {
    const { run } = setup([membership('i', 'inactive', 'OWNER')]);

    expect((await run(null))!.activeTenantId).toBe('i');
  });

  it('si la empresa activa ya no existe (rechazada), cae a ninguna sin membresías', async () => {
    const { run, activeChanges } = setup([]);

    const me = await run('borrada');

    expect(me!.activeTenantId).toBeNull();
    expect(activeChanges).toEqual([null]);
  });

  it('un admin de plataforma ve el contador; los demás reciben null', async () => {
    const admin = setup([], { admins: ['ANA@example.com'], pending: 3 });
    const other = setup([], { admins: ['otro@example.com'], pending: 3 });

    expect(await admin.run(null)).toMatchObject({ isPlatformAdmin: true, platformPendingCount: 3 });
    expect(await other.run(null)).toMatchObject({
      isPlatformAdmin: false,
      platformPendingCount: null,
    });
  });

  it('incluye el último rechazo sin cerrar', async () => {
    const { run } = setup([], { rejection: true });

    expect((await run(null))!.tenantRejection).toMatchObject({
      tenantName: 'Acme',
      reason: 'Datos falsos',
    });
  });
});
