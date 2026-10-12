import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env-schema';

describe('parseWebEnv', () => {
  it('usa mismo origen cuando VITE_API_URL está vacía o ausente', () => {
    expect(parseWebEnv({}).VITE_API_URL).toBe('');
    expect(parseWebEnv({ VITE_API_URL: '' }).VITE_API_URL).toBe('');
  });

  it('acepta una URL absoluta y le quita la barra final', () => {
    expect(parseWebEnv({ VITE_API_URL: 'https://api.example.com/' }).VITE_API_URL).toBe(
      'https://api.example.com',
    );
  });

  it('falla nombrando VITE_API_URL cuando no es URL', () => {
    expect(() => parseWebEnv({ VITE_API_URL: 'no-es-url' })).toThrowError(/VITE_API_URL/);
  });
});
