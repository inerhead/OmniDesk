import { describe, expect, it } from 'vitest';
import { PlatformAdmins } from '../../../shared/application/platform-admins';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import { MemoryAttachmentStorage } from '../../attachments/infrastructure/memory-attachment-storage';
import type { JobLock } from '../../retention/application/ports/job-lock';
import { TENANT_PURGE_BATCH_SIZE, type MemberAccount } from '../domain/tenant-purge';
import type { TenantDeletionRepository } from './ports/tenant-deletion.repository';
import type { PurgeProgress, TenantPurgeStore } from './ports/tenant-purge.store';
import { TenantPurgeJob } from './tenant-purge.job';

const NOW = new Date('2026-10-15T10:00:00Z');
const noTransaction: TransactionRunner = { run: (work) => work(), runDetached: (work) => work() };
const freeLock: JobLock = {
  tryRun: async (_name, work) => ({ acquired: true, result: await work() }),
};

type Counters = Required<PurgeProgress> & {
  completedAt: Date | null;
  lastError: string | null;
  membersDeleted: number;
  usersDeleted: number;
};

/** Una empresa en borrado, en memoria: conversaciones con 2 mensajes y 1 adjunto cada una. */
class FakeStore implements TenantPurgeStore {
  conversations: string[];
  readonly users = new Set<string>();
  tenantExists = true;
  deletedUsers: string[] = [];
  /** Método que falla una vez. */
  failOnce: keyof TenantPurgeStore | null = null;
  readonly record: Counters = {
    conversationsDeleted: 0,
    messagesDeleted: 0,
    attachmentsDeleted: 0,
    objectsDeleted: 0,
    completedAt: null,
    lastError: null,
    membersDeleted: 0,
    usersDeleted: 0,
  };

  constructor(
    readonly tenantId: string,
    conversations: number,
    readonly members: number,
  ) {
    this.conversations = Array.from({ length: conversations }, (_, index) => `c${index}`);
  }

  private maybeFail(method: keyof TenantPurgeStore): void {
    if (this.failOnce !== method) return;
    this.failOnce = null;
    throw new Error(`${method} caído`);
  }

  async tenantsToPurge() {
    return this.tenantExists ? [this.tenantId] : [];
  }

  async lockConversations(_tenantId: string, limit: number) {
    this.maybeFail('lockConversations');
    return this.conversations.slice(0, limit);
  }

  async deleteConversations(_tenantId: string, ids: string[]) {
    this.maybeFail('deleteConversations');
    this.conversations = this.conversations.filter((id) => !ids.includes(id));
    return { conversations: ids.length, messages: ids.length * 2, attachments: ids.length };
  }

  async addProgress(_tenantId: string, progress: PurgeProgress) {
    this.maybeFail('addProgress');
    for (const [field, value] of Object.entries(progress)) {
      this.record[field as keyof PurgeProgress] += value;
    }
  }

  async deleteRemainder(_tenantId: string, orphanUserIds: string[], at: Date) {
    this.maybeFail('deleteRemainder');
    if (this.conversations.length > 0) throw new Error('FK: quedan conversaciones');
    this.deletedUsers.push(...orphanUserIds);
    this.tenantExists = false;
    Object.assign(this.record, {
      completedAt: at,
      lastError: null,
      membersDeleted: this.members,
      usersDeleted: orphanUserIds.length,
    });
    return { members: this.members, users: orphanUserIds.length };
  }

  async recordError(_tenantId: string, error: string) {
    this.record.lastError = error;
  }
}

/** Almacenamiento en memoria que puede fallar una vez al borrar por prefijo. */
class FlakyStorage extends MemoryAttachmentStorage {
  failNext = false;

  override async deletePrefix(prefix: string): Promise<number> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('bucket caído');
    }
    return super.deletePrefix(prefix);
  }
}

/** Transacción sobre el fake: si el trabajo falla, deshace lo que cambió, como PostgreSQL. */
function rollbackOn(store: FakeStore): TransactionRunner {
  return {
    run: async (work) => {
      const snapshot = {
        conversations: [...store.conversations],
        record: { ...store.record },
        tenantExists: store.tenantExists,
        deletedUsers: [...store.deletedUsers],
      };
      try {
        return await work();
      } catch (error) {
        store.conversations = snapshot.conversations;
        Object.assign(store.record, snapshot.record);
        store.tenantExists = snapshot.tenantExists;
        store.deletedUsers = snapshot.deletedUsers;
        throw error;
      }
    },
    runDetached: (work) => work(),
  };
}

const accounts: MemberAccount[] = [
  { userId: 'solo', email: 'solo@example.com', otherActiveMemberships: 0 },
  { userId: 'dos', email: 'dos@example.com', otherActiveMemberships: 1 },
  { userId: 'admin', email: 'admin@example.com', otherActiveMemberships: 0 },
];

async function setup(conversations: number) {
  const store = new FakeStore('t1', conversations, 3);
  const storage = new FlakyStorage();
  const put = (key: string) =>
    storage.put(key, Buffer.from('x'), { contentType: 'text/plain', contentLength: 1 });
  await put('tenants/t1/attachments/a1');
  await put('tenants/t1/attachments/out-1');
  await put('tenants/t1/logo-1');
  await put('tenants/t2/logo-1');
  await put('users/solo/avatar-1');
  await put('users/dos/avatar-1');
  const deletions = {
    memberAccounts: async () => accounts,
  } as unknown as TenantDeletionRepository;
  const job = new TenantPurgeJob(
    store,
    deletions,
    freeLock,
    rollbackOn(store),
    storage,
    new PlatformAdmins(['admin@example.com']),
    { now: () => NOW },
  );
  return { store, storage, job };
}

describe('TenantPurgeJob', () => {
  it('borra por lotes, vacía el prefijo de la empresa y cierra la constancia con los conteos', async () => {
    const conversations = TENANT_PURGE_BATCH_SIZE * 2 + 5;
    const { store, storage, job } = await setup(conversations);

    const [result] = (await job.run())!;

    expect(result).toEqual({
      tenantId: 't1',
      conversations,
      messages: conversations * 2,
      attachments: conversations,
      objects: 3,
      members: 3,
      users: 1,
      failed: false,
    });
    expect(store.record).toEqual({
      conversationsDeleted: conversations,
      messagesDeleted: conversations * 2,
      attachmentsDeleted: conversations,
      objectsDeleted: 3,
      completedAt: NOW,
      lastError: null,
      membersDeleted: 3,
      usersDeleted: 1,
    });
    expect(storage.keys()).toEqual(['tenants/t2/logo-1', 'users/dos/avatar-1']);
  });

  it('solo borra las cuentas huérfanas: ni las que tienen otra empresa ni los admins', async () => {
    const { store, job } = await setup(1);

    await job.run();

    expect(store.deletedUsers).toEqual(['solo']);
  });

  it.each([
    ['un lote de conversaciones', 'deleteConversations' as const],
    ['el conteo de un lote', 'addProgress' as const],
    ['el paso final', 'deleteRemainder' as const],
  ])(
    'si falla %s, guarda el error y la siguiente pasada termina sin duplicar',
    async (_label, method) => {
      const conversations = TENANT_PURGE_BATCH_SIZE + 1;
      const { store, job } = await setup(conversations);
      store.failOnce = method;

      const [first] = (await job.run())!;

      expect(first!.failed).toBe(true);
      expect(store.record.lastError).toMatch(/caído/);
      expect(store.tenantExists).toBe(true);

      await job.run();

      expect(store.tenantExists).toBe(false);
      expect(store.record).toMatchObject({
        conversationsDeleted: conversations,
        messagesDeleted: conversations * 2,
        attachmentsDeleted: conversations,
        lastError: null,
        completedAt: NOW,
      });
    },
  );

  it('si el bucket falla, no borra el resto y la siguiente pasada lo completa', async () => {
    const { store, storage, job } = await setup(3);
    storage.failNext = true;

    const [first] = (await job.run())!;

    expect(first).toMatchObject({ failed: true, conversations: 3 });
    expect(store.record).toMatchObject({ lastError: 'bucket caído', completedAt: null });
    expect(store.tenantExists).toBe(true);

    const [second] = (await job.run())!;

    expect(second).toMatchObject({ failed: false, conversations: 0, objects: 3 });
    expect(store.record).toMatchObject({
      conversationsDeleted: 3,
      objectsDeleted: 3,
      lastError: null,
      completedAt: NOW,
    });
  });

  it('un fallo al borrar las fotos no deshace el borrado', async () => {
    const { store, storage, job } = await setup(0);
    const original = storage.deletePrefix.bind(storage);
    storage.deletePrefix = async (prefix) => {
      if (prefix.startsWith('users/')) throw new Error('bucket caído');
      return original(prefix);
    };

    const [result] = (await job.run())!;

    expect(result!.failed).toBe(false);
    expect(store.tenantExists).toBe(false);
    expect(storage.keys()).toContain('users/solo/avatar-1');
  });

  it('si otra instancia tiene el lock, no hace nada', async () => {
    const { store } = await setup(1);
    const job = new TenantPurgeJob(
      store,
      {} as TenantDeletionRepository,
      { tryRun: async () => ({ acquired: false }) },
      noTransaction,
      new MemoryAttachmentStorage(),
      new PlatformAdmins([]),
      { now: () => NOW },
    );

    expect(await job.run()).toBeNull();
    expect(store.tenantExists).toBe(true);
  });
});
