import { beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import type { ConversationReadModel } from '../../conversations/application/ports/conversation-read-model';
import type { ReleaseConversationUseCase } from '../../conversations/application/release-conversation.use-case';
import { InMemoryMembers } from '../../conversations/testing/in-memory';
import type { SessionRepository } from '../../identity/application/ports/session.repository';
import { RemoveMemberUseCase, UpdateMemberRoleUseCase } from './members.use-cases';

const tx: TransactionRunner = { run: (work) => work(), runDetached: (work) => work() };
const now = new Date('2026-10-12T10:00:00.000Z');
const clock = { now: () => now };
const actor = (memberId: string, role: ActorContext['role']): ActorContext => ({
  userId: `u-${memberId}`,
  tenantId: 't1',
  memberId,
  role,
});

describe('gestión de miembros', () => {
  let members: InMemoryMembers;
  let revoked: Array<[string, string]>;
  let released: Array<{ by: string; conversationId: string; controlVersion: number }>;
  let update: UpdateMemberRoleUseCase;
  let remove: RemoveMemberUseCase;

  beforeEach(() => {
    members = new InMemoryMembers();
    members.add({ id: 'sup', role: 'OWNER', userId: 'u-sup' });
    members.add({ id: 'admin', role: 'ADMIN', userId: 'u-admin' });
    members.add({ id: 'laura', role: 'AGENT', userId: 'u-laura' });
    revoked = [];
    released = [];
    const sessions = {
      revokeForUserInTenant: async (userId: string, tenantId: string) => {
        revoked.push([userId, tenantId]);
        return 1;
      },
    } as unknown as SessionRepository;
    const readModel = {
      listAssignedOpen: async (_tenantId: string, memberId: string) =>
        memberId === 'laura'
          ? [
              { id: 'c1', controlVersion: 3 },
              { id: 'c2', controlVersion: 1 },
            ]
          : [],
    } as unknown as ConversationReadModel;
    const release = {
      execute: async (
        by: ActorContext,
        input: { conversationId: string; controlVersion: number },
      ) => {
        released.push({ by: by.memberId, ...input });
        return { kind: 'ok' };
      },
    } as unknown as ReleaseConversationUseCase;
    update = new UpdateMemberRoleUseCase(tx, members);
    remove = new RemoveMemberUseCase(tx, members, sessions, readModel, release, clock);
  });

  it('el único OWNER no puede degradarse: last-owner, bloqueando antes los OWNER', async () => {
    expect(await update.execute(actor('sup', 'OWNER'), 'sup', 'ADMIN')).toEqual({
      kind: 'last-owner',
    });
    expect(members.ownerLocks).toBe(1);
  });

  it('con otro OWNER sí puede degradarse', async () => {
    await update.execute(actor('sup', 'OWNER'), 'admin', 'OWNER');

    const result = await update.execute(actor('sup', 'OWNER'), 'sup', 'AGENT');

    expect(result).toMatchObject({ kind: 'ok', value: { id: 'sup', role: 'AGENT' } });
  });

  it('solo un OWNER cambia roles', async () => {
    expect(await update.execute(actor('admin', 'ADMIN'), 'laura', 'ADMIN')).toEqual({
      kind: 'forbidden',
    });
  });

  it('quitar a Laura: baja lógica, revoca sus sesiones y libera sus conversaciones', async () => {
    expect(await remove.execute(actor('sup', 'OWNER'), 'laura')).toEqual({
      kind: 'ok',
      value: undefined,
    });

    expect(members.removed.get('laura')).toEqual(now);
    expect(await members.findById('t1', 'laura')).toBeNull();
    expect(revoked).toEqual([['u-laura', 't1']]);
    expect(released).toEqual([
      { by: 'sup', conversationId: 'c1', controlVersion: 3 },
      { by: 'sup', conversationId: 'c2', controlVersion: 1 },
    ]);
  });

  it('ADMIN quita AGENT pero no ADMIN ni OWNER; AGENT no quita a nadie', async () => {
    expect((await remove.execute(actor('admin', 'ADMIN'), 'sup')).kind).toBe('forbidden');
    expect((await remove.execute(actor('laura', 'AGENT'), 'admin')).kind).toBe('forbidden');
    expect((await remove.execute(actor('admin', 'ADMIN'), 'laura')).kind).toBe('ok');
  });

  it('no se puede quitar al último OWNER ni a un miembro ya quitado', async () => {
    expect((await remove.execute(actor('sup', 'OWNER'), 'sup')).kind).toBe('last-owner');
    await remove.execute(actor('sup', 'OWNER'), 'laura');
    expect((await remove.execute(actor('sup', 'OWNER'), 'laura')).kind).toBe('not-found');
  });
});
