import { describe, expect, it } from 'vitest';
import { apiBaseFor, basePathFromBaseUrl, parseWebEnv, realtimeTargetFor } from './env-schema';

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

describe('parseWebEnv — BASE_PATH', () => {
  it('usa /omnidesk por defecto y acepta la raíz vacía', () => {
    expect(parseWebEnv({}).BASE_PATH).toBe('/omnidesk');
    expect(parseWebEnv({ BASE_PATH: '' }).BASE_PATH).toBe('');
    expect(parseWebEnv({ BASE_PATH: '/apps/omnidesk' }).BASE_PATH).toBe('/apps/omnidesk');
  });

  it.each(['omnidesk', '/omnidesk/', '/'])('falla nombrando BASE_PATH con %s', (value) => {
    expect(() => parseWebEnv({ BASE_PATH: value })).toThrowError(/BASE_PATH/);
  });
});

describe('rutas bajo la subruta', () => {
  it('basePathFromBaseUrl quita la barra final de BASE_URL', () => {
    expect(basePathFromBaseUrl('/omnidesk/')).toBe('/omnidesk');
    expect(basePathFromBaseUrl('/')).toBe('');
  });

  it('apiBaseFor usa la subruta en mismo origen y VITE_API_URL si existe', () => {
    expect(apiBaseFor('', '/omnidesk')).toBe('/omnidesk');
    expect(apiBaseFor('https://api.example.com', '/omnidesk')).toBe('https://api.example.com');
  });

  it('realtimeTargetFor pone la subruta en el path de Socket.IO en mismo origen', () => {
    expect(
      realtimeTargetFor('', '/omnidesk', 'https://dev.gastromesa.com', '/api/realtime'),
    ).toEqual({ url: 'https://dev.gastromesa.com', path: '/omnidesk/api/realtime' });
    expect(
      realtimeTargetFor('https://api.example.com', '/omnidesk', 'https://x.com', '/api/realtime'),
    ).toEqual({ url: 'https://api.example.com', path: '/api/realtime' });
  });
});
