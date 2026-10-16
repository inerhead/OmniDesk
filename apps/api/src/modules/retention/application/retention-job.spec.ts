import { describe, expect, it } from 'vitest';
import type { Clock } from '../../../shared/application/clock.port';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import type { AttachmentStorage } from '../../attachments/application/ports/attachment-storage';
import type { JobLock } from './ports/job-lock';
import type { RetentionStore } from './ports/retention-store';
import { RetentionJob } from './retention-job';

const now = new Date('2026-10-14T03:30:00.000Z');
const clock: Clock = { now: () => now };
const tx: TransactionRunner = { run: (work) => work(), runDetached: (work) => work() };
const freeLock: JobLock = {
  tryRun: async (_name, work) => ({ acquired: true, result: await work() }),
};

/** Dos empresas con una conversación vencida cada una; la de `broken` tiene un adjunto. */
function fakeStore() {
  const pending = new Map([
    ['tenant-a', ['conv-a']],
    ['tenant-b', ['conv-b']],
  ]);
  const logged: string[] = [];
  let purged = false;
  let rejectionsCutoff: Date | null = null;
  const store: RetentionStore = {
    tenantsWithRetention: async () => [
      { tenantId: 'tenant-a', retentionDays: 90 },
      { tenantId: 'tenant-b', retentionDays: 90 },
    ],
    lockExpiredConversations: async (tenantId) => pending.get(tenantId) ?? [],
    attachmentKeys: async (tenantId) => (tenantId === 'tenant-a' ? ['key-a'] : []),
    deleteConversations: async (tenantId, ids) => {
      pending.set(tenantId, []);
      return { conversations: ids.length, messages: 2 };
    },
    deleteOrphanContacts: async () => 1,
    lockContactConversations: async () => null,
    deleteContact: async () => undefined,
    logDeletion: async (entry) => void logged.push(entry.tenantId),
    purgeTechnical: async () => {
      purged = true;
      return { outboxEvents: 0, inboxEvents: 0, sessions: 0, invitations: 0 };
    },
    deleteTenantRejectionsBefore: async (cutoff) => {
      rejectionsCutoff = cutoff;
      return 2;
    },
  };
  return {
    store,
    pending,
    logged,
    purged: () => purged,
    rejectionsCutoff: () => rejectionsCutoff,
  };
}

function storageFailingOn(failingKey: string): AttachmentStorage & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    put: async () => undefined,
    get: async () => {
      throw new Error('no usado');
    },
    delete: async (key) => {
      if (key === failingKey) throw new Error('bucket caído');
      deleted.push(key);
    },
    deletePrefix: async () => 0,
  };
}

describe('RetentionJob', () => {
  it('si el bucket falla en una empresa, no borra sus filas y sigue con las demás y la purga', async () => {
    const fake = fakeStore();
    const job = new RetentionJob(fake.store, freeLock, tx, storageFailingOn('key-a'), clock);

    const report = await job.run();

    expect(report?.tenants).toEqual([
      { tenantId: 'tenant-a', conversations: 0, messages: 0, contacts: 0, failed: true },
      { tenantId: 'tenant-b', conversations: 1, messages: 2, contacts: 1, failed: false },
    ]);
    expect(fake.pending.get('tenant-a')).toEqual(['conv-a']);
    expect(fake.logged).toEqual(['tenant-b']);
    expect(fake.purged()).toBe(true);
  });

  it('borra los rechazos de solicitudes de más de 20 días (SPEC 18)', async () => {
    const fake = fakeStore();
    const job = new RetentionJob(fake.store, freeLock, tx, storageFailingOn(''), clock);

    const report = await job.run();

    expect(report?.tenantRejections).toBe(2);
    expect(fake.rejectionsCutoff()).toEqual(new Date('2026-09-24T03:30:00.000Z'));
  });

  it('sin el lock no toca nada y devuelve null', async () => {
    const fake = fakeStore();
    const busy: JobLock = { tryRun: async () => ({ acquired: false }) };
    const job = new RetentionJob(fake.store, busy, tx, storageFailingOn(''), clock);

    expect(await job.run()).toBeNull();
    expect(fake.pending.get('tenant-a')).toEqual(['conv-a']);
    expect(fake.purged()).toBe(false);
  });
});
