import { describe, expect, it } from 'vitest';
import { nextRetentionRunAt, technicalPurgeCutoff } from './retention-schedule';

describe('nextRetentionRunAt', () => {
  it('antes de las 03:30 toca hoy', () => {
    expect(nextRetentionRunAt(new Date(2026, 9, 14, 2, 0))).toEqual(new Date(2026, 9, 14, 3, 30));
  });

  it('a las 03:30 en punto o después toca mañana', () => {
    expect(nextRetentionRunAt(new Date(2026, 9, 14, 3, 30))).toEqual(new Date(2026, 9, 15, 3, 30));
    expect(nextRetentionRunAt(new Date(2026, 9, 14, 18, 0))).toEqual(new Date(2026, 9, 15, 3, 30));
  });

  it('pasa de mes y de año', () => {
    expect(nextRetentionRunAt(new Date(2026, 11, 31, 12, 0))).toEqual(new Date(2027, 0, 1, 3, 30));
  });
});

describe('technicalPurgeCutoff', () => {
  it('resta 30 días exactos', () => {
    const now = new Date('2026-10-14T03:30:00.000Z');
    expect(technicalPurgeCutoff(now).toISOString()).toBe('2026-09-14T03:30:00.000Z');
  });
});
