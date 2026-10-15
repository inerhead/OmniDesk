import { describe, expect, it } from 'vitest';
import { buildHealthReport, outboxState } from './health-report';

const now = new Date('2026-10-12T10:00:00.000Z');

describe('buildHealthReport', () => {
  it('reporta ok cuando la base de datos está arriba', () => {
    expect(buildHealthReport(true, 'ok', now)).toEqual({
      status: 'ok',
      checks: { database: 'up' },
      outbox: 'ok',
      checkedAt: now,
    });
  });

  it('reporta error cuando la base de datos está abajo', () => {
    expect(buildHealthReport(false, 'unknown', now)).toMatchObject({
      status: 'error',
      checks: { database: 'down' },
    });
  });

  it('un Outbox atrasado no cambia el estado general', () => {
    expect(buildHealthReport(true, 'lagging', now)).toMatchObject({
      status: 'ok',
      outbox: 'lagging',
    });
  });
});

describe('outboxState', () => {
  const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it('sin pendientes, o con uno reciente, está al día', () => {
    expect(outboxState(null, now, 60)).toBe('ok');
    expect(outboxState(secondsAgo(60), now, 60)).toBe('ok');
  });

  it('con un pendiente de más del umbral está atrasado', () => {
    expect(outboxState(secondsAgo(61), now, 60)).toBe('lagging');
  });

  it('si no se pudo leer es unknown', () => {
    expect(outboxState(undefined, now, 60)).toBe('unknown');
  });
});
