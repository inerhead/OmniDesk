import type { HealthResponse } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { toStatusView } from './to-status-view';

const health = (database: 'up' | 'down'): HealthResponse => ({
  status: database === 'up' ? 'ok' : 'error',
  checks: { database },
  version: '0.0.0',
  timestamp: '2026-10-12T10:00:00.000Z',
});

describe('toStatusView', () => {
  it('ok cuando API y base de datos responden', () => {
    expect(toStatusView(health('up'), true)).toEqual({ kind: 'ok', label: 'API: ok · DB: ok' });
  });

  it('db-down cuando el API responde con la base de datos caída', () => {
    expect(toStatusView(health('down'), true)).toEqual({
      kind: 'db-down',
      label: 'API: ok · DB: down',
    });
  });

  it('api-down cuando el API no responde', () => {
    expect(toStatusView(null, true)).toEqual({ kind: 'api-down', label: 'API: no disponible' });
  });

  it('offline tiene prioridad sobre cualquier respuesta', () => {
    expect(toStatusView(health('up'), false)).toEqual({ kind: 'offline', label: 'Sin conexión' });
    expect(toStatusView(null, false)).toEqual({ kind: 'offline', label: 'Sin conexión' });
  });
});
