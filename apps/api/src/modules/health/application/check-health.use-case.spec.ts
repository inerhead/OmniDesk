import { describe, expect, it } from 'vitest';
import type { OutboxBacklog } from '../../../shared/application/outbox-backlog.port';
import { CheckHealthUseCase } from './check-health.use-case';
import type { DatabaseHealthPort } from './ports/database-health.port';

const now = new Date('2026-10-12T10:00:00.000Z');
const fakeDatabase = (up: boolean): DatabaseHealthPort => ({ ping: async () => up });
const fakeOutbox = (oldest: Date | null | Error): OutboxBacklog => ({
  pendingByType: async () => [],
  oldestPendingCreatedAt: async () => {
    if (oldest instanceof Error) throw oldest;
    return oldest;
  },
});
const check = (up: boolean, oldest: Date | null | Error = null) =>
  new CheckHealthUseCase(
    fakeDatabase(up),
    fakeOutbox(oldest),
    { OUTBOX_LAG_THRESHOLD_SECONDS: 60 },
    { now: () => now },
  ).execute();

describe('CheckHealthUseCase', () => {
  it('devuelve ok con la base de datos arriba y el Outbox al día', async () => {
    const report = await check(true);

    expect(report.status).toBe('ok');
    expect(report.checks.database).toBe('up');
    expect(report.outbox).toBe('ok');
  });

  it('devuelve error con la base de datos abajo', async () => {
    const report = await check(false);

    expect(report.status).toBe('error');
    expect(report.checks.database).toBe('down');
  });

  it('un pendiente de hace 2 min deja el Outbox lagging sin cambiar el estado', async () => {
    const report = await check(true, new Date(now.getTime() - 120_000));

    expect(report).toMatchObject({ status: 'ok', outbox: 'lagging' });
  });

  it('si no se puede leer el Outbox queda unknown', async () => {
    expect((await check(true, new Error('caída'))).outbox).toBe('unknown');
  });
});
