import { E164Schema } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { buildScenarios } from './scenarios.ts';

describe('buildScenarios', () => {
  it('tiene 5 contactos con 2 a 4 turnos y teléfonos E.164', () => {
    const scenarios = buildScenarios();

    expect(scenarios).toHaveLength(5);
    for (const scenario of scenarios) {
      expect(scenario.turns.length).toBeGreaterThanOrEqual(2);
      expect(scenario.turns.length).toBeLessThanOrEqual(4);
      expect(E164Schema.safeParse(scenario.phone).success).toBe(true);
    }
  });

  it('genera ids deterministas y únicos', () => {
    const ids = buildScenarios().flatMap((scenario) => scenario.turns.map((turn) => turn.id));

    expect(buildScenarios().flatMap((scenario) => scenario.turns.map((turn) => turn.id))).toEqual(
      ids,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('sim-ana-1');
  });
});
