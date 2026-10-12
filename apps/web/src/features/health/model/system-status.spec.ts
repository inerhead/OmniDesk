import type { HealthResponse } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import {
  appendCheck,
  formatAgo,
  HISTORY_SIZE,
  summarizeHistory,
  type CheckRecord,
} from './check-history';
import { SLOW_LATENCY_MS, toSystemStatus } from './system-status';

const health = (database: 'up' | 'down'): HealthResponse => ({
  status: database === 'up' ? 'ok' : 'error',
  checks: { database },
  version: '1.2.3',
  timestamp: '2026-10-12T10:00:00.000Z',
});
const ok = { health: health('up'), latencyMs: 40 };
const states = (status: ReturnType<typeof toSystemStatus>) =>
  Object.fromEntries(status.components.map((c) => [c.id, c.state]));

describe('toSystemStatus', () => {
  it('todo operativo: API con latencia y versión', () => {
    const status = toSystemStatus({ online: true, check: ok, realtime: 'live' });

    expect(status.overall).toBe('operational');
    expect(states(status)).toEqual({ network: 'up', api: 'up', database: 'up', realtime: 'up' });
    expect(status.components.find((c) => c.id === 'api')?.detail).toBe('40 ms · v1.2.3');
  });

  it('base de datos caída', () => {
    const status = toSystemStatus({
      online: true,
      check: { health: health('down'), latencyMs: 30 },
      realtime: 'live',
    });

    expect(status.overall).toBe('down');
    expect(status.title).toBe('La base de datos no responde');
    expect(states(status).database).toBe('down');
  });

  it('API que no responde', () => {
    const status = toSystemStatus({ online: true, check: null, realtime: 'reconnecting' });

    expect(status.overall).toBe('down');
    expect(states(status)).toMatchObject({ api: 'down', database: 'unknown' });
  });

  it('API lento o socket reconectando = degradado', () => {
    expect(
      toSystemStatus({
        online: true,
        check: { ...ok, latencyMs: SLOW_LATENCY_MS + 1 },
        realtime: 'live',
      }).overall,
    ).toBe('degraded');
    const reconnecting = toSystemStatus({ online: true, check: ok, realtime: 'reconnecting' });
    expect(reconnecting.overall).toBe('degraded');
    expect(reconnecting.components.find((c) => c.id === 'realtime')?.detail).toBe(
      'Respaldo cada 15 s',
    );
  });

  it('sin red tiene prioridad', () => {
    const status = toSystemStatus({ online: false, check: ok, realtime: 'live' });

    expect(status.overall).toBe('offline');
    expect(states(status)).toMatchObject({ network: 'down', api: 'unknown' });
  });

  it('primera comprobación en curso', () => {
    expect(toSystemStatus({ online: true, check: undefined, realtime: 'connecting' }).overall).toBe(
      'checking',
    );
  });
});

describe('historial de comprobaciones', () => {
  it('conserva solo las últimas 30', () => {
    let history: CheckRecord[] = Array.from({ length: HISTORY_SIZE }, (_, at) => ({
      at,
      result: 'up' as const,
      latencyMs: 10,
    }));
    history = appendCheck(history, { at: 99, result: 'down', latencyMs: null });

    expect(history).toHaveLength(HISTORY_SIZE);
    expect(history.at(-1)?.at).toBe(99);
    expect(history[0]?.at).toBe(1);
  });

  it('resume disponibilidad y latencia media de las que respondieron', () => {
    expect(
      summarizeHistory([
        { at: 1, result: 'up', latencyMs: 20 },
        { at: 2, result: 'degraded', latencyMs: 1200 },
        { at: 3, result: 'down', latencyMs: null },
        { at: 4, result: 'up', latencyMs: 40 },
      ]),
    ).toEqual({ availability: 75, averageLatencyMs: 420 });
    expect(summarizeHistory([])).toEqual({ availability: null, averageLatencyMs: null });
  });

  it('formatea el tiempo transcurrido', () => {
    expect(formatAgo(1_000, 1_500)).toBe('justo ahora');
    expect(formatAgo(0, 12_000)).toBe('hace 12 s');
    expect(formatAgo(0, 125_000)).toBe('hace 2 min');
  });
});
