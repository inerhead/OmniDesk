import { describe, expect, it } from 'vitest';
import { parseRange } from './byte-range';

describe('parseRange', () => {
  it('sin cabecera o con varios rangos sirve el archivo entero', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
  });

  it('interpreta rangos cerrados, abiertos y de sufijo (Safari pide 0-1)', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('marca invalid lo que no se puede satisfacer (416)', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=5-2', 100)).toBe('invalid');
    expect(parseRange('bytes=-0', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
  });
});
