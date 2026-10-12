import { describe, expect, it } from 'vitest';
import { canTransitionDelivery, type DeliveryStatus } from './delivery';
import type { MessageStatus } from './message';

const TARGETS: DeliveryStatus[] = ['SENT', 'DELIVERED', 'READ', 'FAILED'];

// Cada fila de la tabla del SPEC 05: true = se aplica, false = se ignora ("—" también ignora).
const TABLE: Record<'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED', boolean[]> = {
  //          SENT   DELIVERED READ   FAILED
  PENDING: [true, true, true, true],
  SENT: [false, true, true, true],
  DELIVERED: [false, false, true, false],
  READ: [false, false, false, false],
  FAILED: [true, false, false, false],
};

describe('canTransitionDelivery', () => {
  for (const [from, row] of Object.entries(TABLE)) {
    TARGETS.forEach((to, index) => {
      const expected = row[index]!;
      it(`${from} → ${to}: ${expected ? 'se aplica' : 'se ignora'}`, () => {
        expect(canTransitionDelivery(from as MessageStatus, to)).toBe(expected);
      });
    });
  }

  it.each(TARGETS)('un mensaje entrante (RECEIVED) ignora %s', (to) => {
    expect(canTransitionDelivery('RECEIVED', to)).toBe(false);
  });
});
