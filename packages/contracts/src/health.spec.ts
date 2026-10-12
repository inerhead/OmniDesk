import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health';

describe('HealthResponseSchema', () => {
  it('acepta un payload válido', () => {
    const payload = {
      status: 'ok',
      checks: { database: 'up' },
      version: '0.0.0',
      timestamp: '2026-10-12T10:00:00.000Z',
    };

    expect(HealthResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rechaza un payload sin checks', () => {
    const payload = { status: 'ok', version: '0.0.0', timestamp: '2026-10-12T10:00:00.000Z' };

    expect(HealthResponseSchema.safeParse(payload).success).toBe(false);
  });
});
