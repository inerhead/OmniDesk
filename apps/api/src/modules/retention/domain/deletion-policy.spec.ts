import { describe, expect, it } from 'vitest';
import { canDeleteContact } from './deletion-policy';

describe('canDeleteContact', () => {
  it('solo el OWNER borra contactos', () => {
    expect(canDeleteContact('OWNER')).toBe(true);
    expect(canDeleteContact('ADMIN')).toBe(false);
    expect(canDeleteContact('AGENT')).toBe(false);
  });
});
