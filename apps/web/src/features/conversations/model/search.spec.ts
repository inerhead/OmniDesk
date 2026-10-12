import { describe, expect, it } from 'vitest';
import { normalizeSearch } from './search';

describe('normalizeSearch', () => {
  it('recorta los espacios', () => {
    expect(normalizeSearch('  jua ')).toBe('jua');
    expect(normalizeSearch('300 123')).toBe('300 123');
  });

  it('con menos de 2 caracteres no busca', () => {
    expect(normalizeSearch('')).toBeUndefined();
    expect(normalizeSearch('   ')).toBeUndefined();
    expect(normalizeSearch(' a ')).toBeUndefined();
  });
});
