import { describe, expect, it } from 'vitest';
import { buildHealthReport } from './health-report';

const now = new Date('2026-10-12T10:00:00.000Z');

describe('buildHealthReport', () => {
  it('reporta ok cuando la base de datos está arriba', () => {
    expect(buildHealthReport(true, now)).toEqual({
      status: 'ok',
      checks: { database: 'up' },
      checkedAt: now,
    });
  });

  it('reporta error cuando la base de datos está abajo', () => {
    expect(buildHealthReport(false, now)).toEqual({
      status: 'error',
      checks: { database: 'down' },
      checkedAt: now,
    });
  });
});
