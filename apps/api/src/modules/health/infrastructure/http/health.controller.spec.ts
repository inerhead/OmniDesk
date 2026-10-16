import { describe, expect, it } from 'vitest';
import type { CheckHealthUseCase } from '../../application/check-health.use-case';
import { HealthController } from './health.controller';

describe('HealthController.live (SPEC 19)', () => {
  it('responde ok sin consultar la salud de la base, aunque esta falle', () => {
    let checked = false;
    const failing = {
      execute: async () => {
        checked = true;
        throw new Error('base caída');
      },
    } as unknown as CheckHealthUseCase;

    expect(new HealthController(failing, 'v1').live()).toEqual({ status: 'ok' });
    expect(checked).toBe(false);
  });
});
