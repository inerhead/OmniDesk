import { describe, expect, it } from 'vitest';
import { CheckHealthUseCase } from './check-health.use-case';
import type { DatabaseHealthPort } from './ports/database-health.port';

const fakeDatabase = (up: boolean): DatabaseHealthPort => ({ ping: async () => up });

describe('CheckHealthUseCase', () => {
  it('devuelve ok con la base de datos arriba', async () => {
    const report = await new CheckHealthUseCase(fakeDatabase(true)).execute();

    expect(report.status).toBe('ok');
    expect(report.checks.database).toBe('up');
  });

  it('devuelve error con la base de datos abajo', async () => {
    const report = await new CheckHealthUseCase(fakeDatabase(false)).execute();

    expect(report.status).toBe('error');
    expect(report.checks.database).toBe('down');
  });
});
