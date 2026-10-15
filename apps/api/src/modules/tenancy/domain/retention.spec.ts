import { describe, expect, it } from 'vitest';
import { retentionCutoff, toRetentionDays } from './retention';

describe('retentionCutoff', () => {
  it('resta los días exactos, en milisegundos', () => {
    const now = new Date('2026-10-14T03:30:00.000Z');
    expect(retentionCutoff(now, 90).toISOString()).toBe('2026-07-16T03:30:00.000Z');
    expect(retentionCutoff(now, 365).toISOString()).toBe('2025-10-14T03:30:00.000Z');
  });
});

describe('toRetentionDays', () => {
  it('conserva 90, 180, 365 y null', () => {
    expect(toRetentionDays(90)).toBe(90);
    expect(toRetentionDays(180)).toBe(180);
    expect(toRetentionDays(365)).toBe(365);
    expect(toRetentionDays(null)).toBeNull();
  });

  it('un valor desconocido cuenta como indefinido', () => {
    expect(toRetentionDays(1)).toBeNull();
    expect(toRetentionDays(0)).toBeNull();
  });
});
