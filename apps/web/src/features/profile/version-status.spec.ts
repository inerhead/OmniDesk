import { describe, expect, it } from 'vitest';
import { versionStatus } from './version-status';

describe('versionStatus', () => {
  it('misma versión: same', () => {
    expect(versionStatus('v0.1.7', 'v0.1.7')).toBe('same');
  });

  it('versiones distintas: different, también si la app es más nueva (rollback)', () => {
    expect(versionStatus('v0.1.6', 'v0.1.7')).toBe('different');
    expect(versionStatus('v0.1.7', 'v0.1.6')).toBe('different');
  });

  it('el servidor no respondió: unknown', () => {
    expect(versionStatus('v0.1.7', null)).toBe('unknown');
  });

  it('dev en la app o en el servidor: unknown', () => {
    expect(versionStatus('dev', 'v0.1.7')).toBe('unknown');
    expect(versionStatus('v0.1.7', 'dev')).toBe('unknown');
    expect(versionStatus('dev', 'dev')).toBe('unknown');
  });
});
