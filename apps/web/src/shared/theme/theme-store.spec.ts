import { describe, expect, it } from 'vitest';
import { parseThemePref, resolveTheme } from './theme-store';

describe('resolveTheme', () => {
  it('claro y oscuro ignoran el sistema', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('sistema sigue la preferencia del sistema operativo', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('parseThemePref', () => {
  it('acepta light y dark; cualquier otro valor es system', () => {
    expect(parseThemePref('light')).toBe('light');
    expect(parseThemePref('dark')).toBe('dark');
    expect(parseThemePref('system')).toBe('system');
    expect(parseThemePref(null)).toBe('system');
    expect(parseThemePref('azul')).toBe('system');
  });
});
